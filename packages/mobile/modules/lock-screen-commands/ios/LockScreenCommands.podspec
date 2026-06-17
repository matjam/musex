Pod::Spec.new do |s|
  s.name           = 'LockScreenCommands'
  s.version        = '1.0.0'
  s.summary        = 'Lock-screen next/previous track commands for musex'
  s.description    = 'Bridges iOS MPRemoteCommandCenter next/previous to JS events'
  s.author         = 'musex'
  s.homepage       = 'https://github.com/matjam/musex'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
