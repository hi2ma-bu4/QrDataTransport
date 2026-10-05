param(
    [Parameter(Position = 0)]
    [string]$From,

    [Parameter(Position = 1)]
    [string]$To
)

$specFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*v8.md" -File)

if ($specFiles.Count -eq 0) {
    throw "Specification file (*v8.md) was not found: $PSScriptRoot"
}

if ($specFiles.Count -gt 1) {
    throw "Multiple specification files matching *v8.md were found: $PSScriptRoot"
}

$specFile = $specFiles[0]
$path = $specFile.FullName

$lines = Get-Content -LiteralPath $path -Encoding utf8

$sections = [System.Collections.Generic.List[object]]::new()

# Collect Markdown headings.
for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]

    if ($line -match '^(#{1,6})\s+(.+?)\s*$') {
        $sections.Add([PSCustomObject]@{
            Level = $matches[1].Length
            Title = $matches[2]
            Start = $i + 1
            End   = $lines.Count
        })
    }
}

# Determine the end line of each section.
for ($i = 0; $i -lt $sections.Count; $i++) {
    $current = $sections[$i]

    for ($j = $i + 1; $j -lt $sections.Count; $j++) {
        $next = $sections[$j]

        if ($next.Level -le $current.Level) {
            $current.End = $next.Start - 1
            break
        }
    }
}

function Find-Section {
    param(
        [string]$Query
    )

    $matches = [System.Collections.Generic.List[object]]::new()

    foreach ($sectionInfo in $sections) {
        # Exact title match
        if ($sectionInfo.Title -eq $Query) {
            $matches.Add($sectionInfo)
            continue
        }

        # Prefix match, useful for "7." / "10."
        if ($sectionInfo.Title.StartsWith($Query, [System.StringComparison]::Ordinal)) {
            $matches.Add($sectionInfo)
        }
    }

    if ($matches.Count -eq 0) {
        return $null
    }

    if ($matches.Count -gt 1) {
        Write-Host "Multiple sections matched: $Query" -ForegroundColor Red
        Write-Host ""

        foreach ($match in $matches) {
            Write-Host "  $($match.Title) [L$($match.Start)-L$($match.End)]"
        }

        return $null
    }

    return $matches[0]
}

function Copy-SectionRange {
    param(
        [object]$StartSection,
        [object]$EndSection
    )

    $startLine = $StartSection.Start
    $endLine = $EndSection.End

    if ($startLine -gt $endLine) {
        throw "Invalid section range."
    }

    $resultLines = [System.Collections.Generic.List[string]]::new()

    for ($i = $startLine - 1; $i -lt $endLine; $i++) {
        $resultLines.Add($lines[$i])
    }

    $result = $resultLines -join [Environment]::NewLine

    $result | Set-Clipboard

    # Write-Host $result
    # Write-Host ""
    Write-Host "Copied L$startLine-L$endLine to the clipboard." -ForegroundColor Green
}

# ------------------------------------------------------------
# No arguments:
# Display the section list.
# ------------------------------------------------------------
if (-not $From) {
    if ($To) {
        throw "The second argument cannot be used without the first argument."
    }

    $output = [System.Text.StringBuilder]::new()

    [void]$output.AppendLine("# Specification Section List")
    [void]$output.AppendLine()
    [void]$output.AppendLine("File: docs\$($specFile.Name)")
    [void]$output.AppendLine("Total lines: $($lines.Count)")
    [void]$output.AppendLine()

    foreach ($sectionInfo in $sections) {
        $indent = "  " * ($sectionInfo.Level - 1)

        [void]$output.AppendLine(
            "$indent- $($sectionInfo.Title) [L$($sectionInfo.Start)-L$($sectionInfo.End)]"
        )
    }

    $result = $output.ToString().TrimEnd()

    $result | Set-Clipboard

    # Write-Host $result
    # Write-Host ""
    Write-Host "Section list copied to the clipboard." -ForegroundColor Green

    exit 0
}

# ------------------------------------------------------------
# Find start section.
# ------------------------------------------------------------
$startSection = Find-Section $From

if ($null -eq $startSection) {
    Write-Host "Start section not found: $From" -ForegroundColor Red
    exit 1
}

# ------------------------------------------------------------
# Single section.
# ------------------------------------------------------------
if (-not $To) {
    Copy-SectionRange $startSection $startSection
    exit 0
}

# ------------------------------------------------------------
# Find end section.
# ------------------------------------------------------------
$endSection = Find-Section $To

if ($null -eq $endSection) {
    Write-Host "End section not found: $To" -ForegroundColor Red
    exit 1
}

# Make sure the end section appears after the start section.
if ($endSection.Start -lt $startSection.Start) {
    throw "The end section appears before the start section."
}

Copy-SectionRange $startSection $endSection
