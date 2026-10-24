$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$target=Join-Path $PSScriptRoot '../public/mobile/icons'
[System.IO.Directory]::CreateDirectory($target) | Out-Null
foreach($size in @(180,192,512)) {
  $bitmap=[System.Drawing.Bitmap]::new($size,$size)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#10151e'))
  $blue=[System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#6aa7ff'),[single]($size*20/512))
  $gold=[System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#ffc53d'),[single]($size*20/512))
  try {
    $scale=$size/512
    $graphics.DrawEllipse($blue,[single](107*$scale),[single](164*$scale),[single](184*$scale),[single](184*$scale))
    $graphics.DrawEllipse($gold,[single](221*$scale),[single](164*$scale),[single](184*$scale),[single](184*$scale))
    $name=if($size -eq 180){'apple-touch-icon.png'}else{"icon-$size.png"}
    $bitmap.Save((Join-Path $target $name),[System.Drawing.Imaging.ImageFormat]::Png)
  } finally {$gold.Dispose();$blue.Dispose();$graphics.Dispose();$bitmap.Dispose()}
}
