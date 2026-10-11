#!/usr/bin/env ruby
# Adds the Apple Watch app (step 3 of docs/adr/0002-apple-watch-remote.md) to
# App.xcodeproj without Xcode's GUI, using the xcodeproj gem
# (`gem install xcodeproj`). Already run and committed; kept so the change is
# reviewable and repeatable after a project regeneration. Run from anywhere:
#
#   ruby workout-tracker/ios/scripts/add-watch-app-target.rb
#
# It refuses to run twice. What it does:
# - A single-target watchOS 10 app, `WatchApp`, whose sources are the
#   ios/App/WatchApp folder as a file-system synchronized group: files added
#   there later need no .pbxproj edits. Info.plist and the entitlements are
#   excluded from the target's resources, as for LiveActivityWidget.
# - Links AppLogic (the local package App already uses) into it.
# - Embeds it in App ("Embed Watch Content") and makes App depend on it, so
#   every App build or archive builds the watch app too.
# - App: HealthKit entitlements, iOS 17 (workout mirroring), and the
#   WorkoutMirroring.swift source. AppUITests and the project default follow
#   to iOS 17.
require 'xcodeproj'

APP_DIR = File.expand_path('../App', __dir__)
Dir.chdir(APP_DIR)

project = Xcodeproj::Project.open('App.xcodeproj')
abort 'WatchApp target already exists; nothing to do.' if project.targets.any? { |t| t.name == 'WatchApp' }

app = project.targets.find { |t| t.name == 'App' } or abort 'no App target'
ui_tests = project.targets.find { |t| t.name == 'AppUITests' }
app_settings = app.build_configurations.find { |c| c.name == 'Release' }.build_settings
bundle_id = app_settings['PRODUCT_BUNDLE_IDENTIFIER']
team = app_settings['DEVELOPMENT_TEAM']

# --- The watch app target -------------------------------------------------

watch = project.new_target(:application, 'WatchApp', :watchos, '10.0', project.products_group, :swift)

# new_target links Foundation by absolute SDK path, which nothing else in
# this project does and a Swift app doesn't need (see "Add a UI test target"
# in ios/MANUAL_SETUP.md for the same cleanup).
watch.frameworks_build_phase.files.dup.each do |build_file|
  next unless build_file.file_ref&.display_name == 'Foundation.framework'
  ref = build_file.file_ref
  parent = ref.parent
  build_file.remove_from_project
  ref.remove_from_project
  parent.remove_from_project if parent.respond_to?(:children) && parent.children.empty?
end

watch.build_configurations.each do |config|
  settings = config.build_settings
  settings.delete('ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES') # watchOS 10 ships Swift
  settings.delete('ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME') # no AccentColor asset
  settings.merge!(
    'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
    'CODE_SIGN_ENTITLEMENTS' => 'WatchApp/WatchApp.entitlements',
    'CODE_SIGN_STYLE' => 'Automatic',
    # Must match the containing app's, or App Store Connect rejects the upload.
    'CURRENT_PROJECT_VERSION' => app_settings['CURRENT_PROJECT_VERSION'],
    'DEVELOPMENT_TEAM' => team,
    'ENABLE_PREVIEWS' => 'YES',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'INFOPLIST_FILE' => 'WatchApp/Info.plist',
    'INFOPLIST_KEY_CFBundleDisplayName' => 'Workout Tracker',
    'INFOPLIST_KEY_NSHealthShareUsageDescription' =>
      'Workout Tracker reads your heart rate and calories during workouts you track on your Apple Watch.',
    'INFOPLIST_KEY_NSHealthUpdateUsageDescription' =>
      'Workout Tracker saves your strength training workouts to Apple Health, so they count toward your Activity rings.',
    'INFOPLIST_KEY_UISupportedInterfaceOrientations' =>
      'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown',
    'INFOPLIST_KEY_WKCompanionAppBundleIdentifier' => bundle_id,
    'INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp' => 'NO',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks',
    'MARKETING_VERSION' => app_settings['MARKETING_VERSION'],
    'PRODUCT_BUNDLE_IDENTIFIER' => "#{bundle_id}.watchkitapp",
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'SDKROOT' => 'watchos',
    'SKIP_INSTALL' => 'YES', # archived inside App, not on its own
    'SWIFT_EMIT_LOC_STRINGS' => 'YES',
    'SWIFT_VERSION' => app_settings['SWIFT_VERSION'],
    'TARGETED_DEVICE_FAMILY' => '4',
    'WATCHOS_DEPLOYMENT_TARGET' => '10.0'
  )
end

# Sources: the WatchApp folder, synchronized.
group = project.new(Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup)
group.path = 'WatchApp'
group.source_tree = '<group>'
group.explicit_file_types = {}
group.explicit_folders = []
exceptions = project.new(Xcodeproj::Project::Object::PBXFileSystemSynchronizedBuildFileExceptionSet)
exceptions.target = watch
exceptions.membership_exceptions = %w[Info.plist WatchApp.entitlements]
group.exceptions << exceptions
project.main_group.children << group
watch.file_system_synchronized_groups << group

# AppLogic, from the local package reference App already has.
package = project.root_object.package_references.find do |ref|
  ref.is_a?(Xcodeproj::Project::Object::XCLocalSwiftPackageReference) && ref.relative_path == 'AppLogic'
end or abort 'no local AppLogic package reference'
product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
product.package = package
product.product_name = 'AppLogic'
watch.package_product_dependencies << product
link = project.new(Xcodeproj::Project::Object::PBXBuildFile)
link.product_ref = product
watch.frameworks_build_phase.files << link

# --- Embed it in App --------------------------------------------------------

app.add_dependency(watch)
embed = app.new_copy_files_build_phase('Embed Watch Content')
embed.dst_subfolder_spec = Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:products_directory]
embed.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
embedded = embed.add_file_reference(watch.product_reference)
embedded.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

# --- App: HealthKit, iOS 17, workout mirroring --------------------------------

app_group = project.main_group['App'] or abort 'no App group'
unless app_group.files.any? { |f| f.path == 'WorkoutMirroring.swift' }
  app.source_build_phase.add_file_reference(app_group.new_reference('WorkoutMirroring.swift'))
end
unless app_group.files.any? { |f| f.path == 'App.entitlements' }
  app_group.new_reference('App.entitlements') # listed in the navigator, not built
end

app.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
end
([app, ui_tests].compact.flat_map(&:build_configurations) + project.build_configurations).each do |config|
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0' if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
end

project.save
puts 'Added WatchApp. Commit App.xcodeproj/project.pbxproj.'
