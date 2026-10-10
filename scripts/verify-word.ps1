param([string]$DocumentPath = 'artifacts/export-verification/report.docx')
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $DocumentPath).Path
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$word.AutomationSecurity = 3
$opened = $null
try {
    $opened = $word.Documents.Open($resolved, $false, $true, $false)
    $images = $opened.InlineShapes.Count + $opened.Shapes.Count
    [PSCustomObject]@{ File = $resolved; Images = $images; Tables = $opened.Tables.Count; Characters = $opened.Content.Text.Length; Pages = $opened.ComputeStatistics(2) } | ConvertTo-Json
    if ($resolved.EndsWith('.docx')) {
        if ($images -ne 3) { throw "Expected 3 Mermaid images, Word reports $images" }
        if ($opened.Content.Text -notmatch 'Markdown Viewer' -or $opened.Content.Text -notmatch '兼容性检查') { throw 'Sample text is missing' }
    }
    $pdfPath = [IO.Path]::ChangeExtension($resolved, '.word-preview.pdf')
    $opened.ExportAsFixedFormat($pdfPath, 17)
    Write-Output "Word rendered PDF: $pdfPath"
} finally {
    if ($null -ne $opened) { $opened.Close(0) }
    $word.Quit()
    if ($null -ne $opened) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($opened) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
}
