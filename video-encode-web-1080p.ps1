# Set the path to ffmpeg
$ffmpegPath = "C:\ffmpeg\ffmpeg.exe"
$plexEncoder = "C:\Program Files\Plex\Plex Media Server\Plex Transcoder.exe"
# Set the input and output paths
$inputPath = "D:\Videos\CHUNKS"
$outputPath = "D:\Videos\ENCODED"
$sourcePath = "D:\Videos\SOURCE"
$finalPath = "D:\Videos\FINAL"
$fileExtention = "mov"
$crf = 17
$vmafMin = 96.2
$vmafMax = 97.6
$crfCount = 0
$crfTotal = 0
$crfAvg = 0
$vmafCount = 0
$vmafTotal = 0
$vmafAvg = 0
$crfMin = 16
$crfMax = 20
New-Item -ItemType "file" -Path "D:\Videos\FINAL\encodinglog.txt"
New-Item -ItemType "file" -Path "D:\Videos\TEMP\files.txt"
New-Item -ItemType "file" -Path "D:\Videos\TEMP\scenes.log"


Get-ChildItem -Path $sourcePath -Filter *.mkv | ForEach-Object {
$sourceFile = $_.BaseName
$sourceFileFull = $_.FullName

# Split the video
#write-host "Starting Splitting" -ForegroundColor Yellow

# Re-encode to FFV1
& $ffmpegPath -y -v quiet -stats -i $_.FullName -sn -an -c:v ffv1 -level 3 -threads 4 -coder 1 -context 1 -slicecrc 1 -slices 24 -g 1 "D:\Videos\TEMP\intermediate.mov"

# Detect scenes with SceneDetect and save to CSV
$csvPath = "D:\Videos\TEMP\intermediate-Scenes.csv"
& scenedetect -i "D:\Videos\TEMP\intermediate.mov" detect-content -t 25 list-scenes -o "D:\Videos\TEMP"

# Parse the CSV manually - read all lines, skip header, extract column 3 (Start Time in seconds), skip first scene
$csvLines = Get-Content $csvPath | Select-Object -Skip 1  # Skip header
$times = @()
foreach ($line in $csvLines | Select-Object -Skip 1) {  # Skip first scene at 0.000
    $columns = $line -split ','
    $times += $columns[3]  # Column 3 is "Start Time (seconds)"
}
$segmentTimes = $times -join ","

# Split with FFmpeg
write-host "Splitting into scenes with command ffmpeg -y -stats -i D:\Videos\TEMP\intermediate.mov -f segment -segment_times $segmentTimes -reset_timestamps 1 -c:v copy -c:a copy D:\Videos\CHUNKS\split%06d.mov" -ForegroundColor Yellow
& $ffmpegPath -y -stats -i "D:\Videos\TEMP\intermediate.mov" -f segment -segment_times $segmentTimes -reset_timestamps 1 -c:v copy -c:a copy "D:\Videos\CHUNKS\split%06d.mov"

# Convert the audio
#write-host "Converting Audio" -ForegroundColor Yellow
& $ffmpegPath -y -v quiet -stats -i $_.FullName "D:\Videos\EAE\audio.flac"
& $plexEncoder -i "D:\Videos\EAE\audio.flac" -eae_root "D:\Videos\EAE" "D:\Videos\TEMP\audio.eac3"

write-host "Starting encoding" -ForegroundColor Yellow

# Loop through each file in the input directory
Get-ChildItem -Path $inputPath -Filter *.mov | ForEach-Object {

    # Set the starting CRF value
    $crf = $crf
    $vmafOutput = ""
    $vmafScore = $null

    # Build the output file path
    $filename = $_.BaseName
    $outputFilename = "$filename.$fileExtention"
    $outputFile = Join-Path $outputPath $outputFilename

    # Encode the file with the current CRF value
    Write-Host "Encoding chunk $($outputFile) with CRF $crf" -ForegroundColor Green
    & $ffmpegPath -y -v quiet -stats -i $_.FullName -c:v libx264 -crf $crf -x264-params partitions=i4x4+p8x8+b8x8 -trellis 2 -deblock -3:-3 -b_qfactor 1 -i_qfactor 0.71 -qcomp 0.50 -maxrate 12000K -bufsize 14000k -qmax 40 -subq 10 -me_method umh -me_range 24 -b_strategy 2 -movflags -faststart -bf 2 -sc_threshold 0 -g 48 -keyint_min 48 -flags -loop $outputFile

    # Calculate the VMAF score
    $vmafOutput = & $ffmpegPath -i $outputFile -i $_.FullName -lavfi "libvmaf=model=path='vmaf_v0.6.1.json':pool=harmonic_mean:n_threads=20" -f null - 2>&1
    
    # Extract the VMAF score from the output
    $vmafScore = [double](([regex]::Matches($vmafOutput, "VMAF score: ([0-9]+\.[0-9]+)").Groups)[1].Value)

    # Check if the VMAF score is below 95 or above 97
    while ((($vmafScore -lt $vmafMin -or $vmafScore -gt $vmafMax) -and $crf -gt $crfMin) -and $crf -lt $crfMax){

    if ($vmafScore -lt $vmafMin) {
        # Decrease the CRF value by 1 and re-encode the file

        $crf--
        Write-Host "VMAF score of $vmafScore for $($outputFile) too low. Re-encoding with CRF is $crf" -ForegroundColor Magenta
        & $ffmpegPath -y -v quiet -stats -i $_.FullName -c:v libx264 -crf $crf -x264-params partitions=i4x4+p8x8+b8x8 -trellis 2 -deblock -3:-3 -b_qfactor 1 -i_qfactor 0.71 -qcomp 0.50 -maxrate 12000K -bufsize 24000k -qmax 40 -subq 10 -me_method umh -me_range 24 -b_strategy 2 -movflags -faststart -bf 2 -sc_threshold 0 -g 48 -keyint_min 48 -flags -loop $outputFile

        # Calculate the VMAF score
        $vmafOutput = ""
        $vmafScore = $null
        $vmafOutput = & $ffmpegPath -i $outputFile -i $_.FullName -lavfi "libvmaf=model=path='vmaf_v0.6.1.json':pool=harmonic_mean:n_threads=20" -f null - 2>&1
                
        # Extract the VMAF score from the output
        $vmafScore = [double](([regex]::Matches($vmafOutput, "VMAF score: ([0-9]+\.[0-9]+)").Groups)[1].Value)
        
    } elseif ($vmafScore -gt $vmafMax) {

        # Increase the CRF value by 1 and re-encode the file
        $crf++
        Write-Host "VMAF score of $vmafScore for $($outputFile) too high. Re-encoding with CRF is $crf" -ForegroundColor Magenta
        & $ffmpegPath -y -stats -v quiet -i $_.FullName -c:v libx264 -crf $crf -x264-params partitions=i4x4+p8x8+b8x8 -trellis 2 -deblock -3:-3 -b_qfactor 1 -i_qfactor 0.71 -qcomp 0.50 -maxrate 12000K -bufsize 24000k -qmax 40 -subq 10 -me_method umh -me_range 24 -b_strategy 2 -movflags -faststart -bf 2 -sc_threshold 0 -g 48 -keyint_min 48 -flags -loop $outputFile

        # Calculate the VMAF score
        $vmafOutput = ""
        $vmafScore = $null
        $vmafOutput = & $ffmpegPath -i $outputFile -i $_.FullName -lavfi "libvmaf=model=path='vmaf_v0.6.1.json':pool=harmonic_mean:n_threads=20" -f null - 2>&1
                
        # Extract the VMAF score from the output
        $vmafScore = [double](([regex]::Matches($vmafOutput, "VMAF score: ([0-9]+\.[0-9]+)").Groups)[1].Value)
        }
    }
    Add-Content -Path "D:\Videos\FINAL\encodinglog.txt" -Value "$($outputFile), CRF: $crf, VMAF: $vmafScore"
    Add-Content -Path "D:\Videos\TEMP\files.txt" -Value "file '$($outputFile)'"
    Write-Host "VMAF score of $vmafScore for $($outputFile) with CRF $crf OK. Encoding next chunk." -ForegroundColor green
    $crfCount++
    $crfTotal = $crfTotal + $crf
    $crfAvg = $crfTotal / $crfCount
    $vmafCount++
    $vmafTotal = $vmafTotal + $vmafScore
    $vmafAvg = $vmafTotal / $vmafCount
    write-host "VMAF Avg: $vmafAvg, CRF Avg: $crfAvg" -ForegroundColor Cyan

    if ($crf -eq $crfMin) {
    $crf++
    } elseif ($crf -eq $crfMax){
    $crf--}

    #if ($vmafAvg -lt $vmafMin) {
    #    $vmafMin++
    #    $vmafMax++
    #    write-host "VMAF Avg getting too low.increasing min and max VMAF to $vmafMin and $vmafMax" -foregroundColor Red
    #    }
}

Add-Content -Path "D:\Videos\FINAL\encodinglog.txt" -Value "VMAF Avg: $vmafAvg, CRF Avg: $crfAvg"

write-host "Merging Files" -ForegroundColor Yellow
& $ffmpegPath -y -v quiet -stats -f concat -safe 0 -i "D:\Videos\TEMP\files.txt" -c copy "D:\Videos\TEMP\1080p.mp4"


# Build the output file path
#    
    $finalExtention = "mkv"
    $finalName = $sourcefile
    $finalFilename = "$finalName.$finalExtention"
    $finalOutputFile = Join-Path $finalPath $finalFilename

#write-host "Creating Final File" -ForegroundColor Yellow
& $ffmpegPath -y -v quiet -stats -i "D:\Videos\TEMP\1080p.mp4" -i "D:\Videos\TEMP\audio.eac3" -c:v copy -c:a copy $finalOutputFile


write-host "Cleaning up" -ForegroundColor Yellow

Get-ChildItem -Path $inputPath | ForEach-Object {
Remove-Item -Path $_.FullName
}

Get-ChildItem -Path $outputPath | ForEach-Object {
Remove-Item -Path $_.FullName
}

Get-ChildItem -Path "D:\Videos\TEMP" | ForEach-Object {
Remove-Item -Path $_.FullName
}
}
write-host "Encoding finished! See you soon!" -ForegroundColor Yellow
