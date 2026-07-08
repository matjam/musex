Pod::Spec.new do |s|
  s.name           = 'BackgroundDownloads'
  s.version        = '1.0.0'
  s.summary        = 'Background URLSession download engine for musex'
  s.description    = 'Runs musex downloads (Original files + HLS AAC stitching) on a background URLSession so they continue while the app is suspended or killed'
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
