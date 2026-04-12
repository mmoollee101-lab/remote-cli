Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 64, 128, 256)
$pngBlobs = @()

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Purple gradient background circle
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(139, 92, 246),
        [System.Drawing.Color]::FromArgb(91, 33, 182),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    $g.FillEllipse($brush, 0, 0, $size - 1, $size - 1)
    $brush.Dispose()

    # Subtle outer ring
    if ($size -ge 32) {
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 255, 255, 255), [Math]::Max(1, [int]($size / 64)))
        $g.DrawEllipse($pen, 0, 0, $size - 1, $size - 1)
        $pen.Dispose()
    }

    # Scales of justice glyph (white)
    $fontSize = [float]($size * 0.62)
    $font = New-Object System.Drawing.Font('Segoe UI Symbol', $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rectF = New-Object System.Drawing.RectangleF(0, [float]($size * 0.02), [float]$size, [float]$size)
    $g.DrawString([char]0x2696, $font, [System.Drawing.Brushes]::White, $rectF, $sf)
    $font.Dispose()
    $sf.Dispose()
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBlobs += ,@($size, $ms.ToArray())
    $ms.Dispose()
    $bmp.Dispose()
}

$outPath = Join-Path $PSScriptRoot 'law-app.ico'
$fs = [System.IO.File]::Create($outPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header
$bw.Write([uint16]0)                  # reserved
$bw.Write([uint16]1)                  # type = 1 (icon)
$bw.Write([uint16]$pngBlobs.Count)    # image count

# ICONDIRENTRY records
$offset = 6 + (16 * $pngBlobs.Count)
foreach ($blob in $pngBlobs) {
    $sz = $blob[0]
    $data = $blob[1]
    $wh = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
    $bw.Write($wh)                    # width
    $bw.Write($wh)                    # height
    $bw.Write([byte]0)                # palette
    $bw.Write([byte]0)                # reserved
    $bw.Write([uint16]1)              # color planes
    $bw.Write([uint16]32)             # bits per pixel
    $bw.Write([uint32]$data.Length)   # size
    $bw.Write([uint32]$offset)        # offset
    $offset += $data.Length
}

# Image data (PNG blobs)
foreach ($blob in $pngBlobs) {
    $bw.Write($blob[1])
}

$bw.Close()
$fs.Close()

Write-Host "Created: $outPath ($((Get-Item $outPath).Length) bytes)"
