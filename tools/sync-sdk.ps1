<#
.SYNOPSIS
    Replace a module's vendored copy of the BP+ JavaScript SDK, and record which
    copy it is.

.DESCRIPTION
    REDCap serves only a module's own directory, so the SDK has to be physically
    present inside each module. A submodule or an npm dependency cannot change
    that -- only where the copy comes from. What can be managed is whether
    anyone knows which copy it is.

    A version number records only what nobody changed, so this records a hash of
    the folder as well. Two copies reporting the same SDK_VERSION can still
    differ, and nothing reveals it until a measurement behaves differently on one
    site and not another -- which is why sdk/ is replaced by this script and
    never edited in place.

    The folder is replaced wholesale rather than merged. A sync that leaves a
    file behind produces a mixture that matches no upstream commit and cannot be
    reasoned about afterwards.

.PARAMETER Module
    The module to sync, e.g. bpplus_data_capture. Omit for all of them.

.PARAMETER Consumer
    A folder outside this repository that vendors the SDK -- bpconnect, or a
    study's own module. It must contain an sdk/ folder. Mutually exclusive with
    -Module.

.PARAMETER Source
    A path to the SDK folder to copy from -- a checkout of the SDK repository,
    or another project carrying it. Required unless -Verify.

.PARAMETER Ref
    The tag or commit the source is at. Read from git when the source is inside
    a repository, so it is normally not needed.

.PARAMETER Verify
    Check the vendored copies against their recorded hashes and change nothing.
    This is what says whether anybody has edited sdk/ in place.

.EXAMPLE
    .\tools\sync-sdk.ps1 -Verify

.EXAMPLE
    .\tools\sync-sdk.ps1 -Module bpplus_data_capture -Source D:\BPplus\JavaScript\bpplus-js-sdk\sdk
#>

[CmdletBinding()]
param(
    [string] $Module,
    [string] $Consumer,
    [string] $Source,
    [string] $Ref,
    [switch] $Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

# Named in every manifest this writes, so a copy in another repository says where
# the tool actually is instead of pointing at a path relative to itself.
$SyncRepo = 'https://github.com/Uscom/bpplus-redcap'

<#
    The hash of the SDK's contents, independent of file order and of line
    endings.

    Line endings matter here more than they look: .gitattributes stores and
    checks out LF, but a copy made on a machine configured otherwise would hash
    differently while being the same code -- which would make -Verify cry wolf
    on every machine but one.
#>
function Get-SdkHash {
    param([string] $Path)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashOf = @{}

    foreach ($file in (Get-ChildItem -Path $Path -Recurse -File -Filter *.js)) {
        $relative = $file.FullName.Substring($Path.Length).Replace('\', '/').TrimStart('/')
        $text = [System.IO.File]::ReadAllText($file.FullName) -replace "`r`n", "`n"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        $hashOf[$relative] = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLower()
    }

    # Ordinal, explicitly. Sort-Object compares the way the current culture does,
    # which treats a hyphen as ignorable -- so it puts usb-serial.js before
    # usb-serial-drivers.js, while every ordinal comparison, JavaScript's
    # included, does the opposite. The two implementations would then disagree
    # about a folder neither had touched, and a check that disagrees with itself
    # is worse than no check at all.
    $names = [System.Collections.Generic.List[string]]::new()
    foreach ($key in $hashOf.Keys) { [void]$names.Add($key) }
    $names.Sort([System.StringComparer]::Ordinal)

    $parts = New-Object System.Text.StringBuilder
    foreach ($name in $names) {
        # Explicit LF, not AppendLine: AppendLine uses Environment.NewLine, so
        # the same folder would hash differently on Windows and on a Linux CI
        # runner -- and test/smoke.mjs has to agree with this or it means
        # nothing.
        [void]$parts.Append("$name $($hashOf[$name])`n")
    }

    $all = [System.Text.Encoding]::UTF8.GetBytes($parts.ToString())
    return [System.BitConverter]::ToString($sha.ComputeHash($all)).Replace('-', '').ToLower()
}

<#
    Run git and return its output, or $null when it fails.

    Wrapped because of Windows PowerShell 5.1: with $ErrorActionPreference set
    to Stop, anything a native executable writes to stderr becomes a terminating
    NativeCommandError. `git describe` in a repository with no tags writes
    "fatal: No names found" and exits non-zero, which is a perfectly ordinary
    answer to the question and not a reason to stop.
#>
function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return ($output | Out-String).Trim()
    } catch {
        return $null
    } finally {
        $ErrorActionPreference = $previous
    }
}

<#
    Every folder to sync: the modules in this repository, or one named consumer
    anywhere on disk.

    -Consumer exists because the modules here are not the only things that vendor
    this SDK. A tool that can only reach the copies in its own repository leaves
    every other copy to be updated by hand, and a copy nobody records is a copy
    that can drift without anyone noticing.
#>
function Get-TargetModules {
    if ($Consumer) {
        if ($Module) { throw 'Give -Module or -Consumer, not both.' }

        $dir = Get-Item -Path $Consumer -ErrorAction SilentlyContinue
        if (-not $dir) { throw "No such folder: $Consumer" }
        if (-not (Test-Path (Join-Path $dir.FullName 'sdk'))) {
            throw "$($dir.FullName) has no sdk/ folder to replace."
        }
        return @($dir)
    }

    $dirs = Get-ChildItem -Path (Join-Path $root 'modules') -Directory
    if ($Module) {
        $dirs = $dirs | Where-Object Name -eq $Module
        if (-not $dirs) { throw "No module named '$Module' in modules/" }
    }
    return $dirs | Where-Object { Test-Path (Join-Path $_.FullName 'sdk') }
}

# -- Verify --------------------------------------------------------------------

if ($Verify) {
    $bad = 0

    foreach ($dir in Get-TargetModules) {
        $sdk = Join-Path $dir.FullName 'sdk'
        $provenanceFile = Join-Path $sdk 'SDK-VERSION.json'

        if (-not (Test-Path $provenanceFile)) {
            Write-Host "FAIL $($dir.Name): sdk/ has no SDK-VERSION.json" -ForegroundColor Red
            $bad++
            continue
        }

        $provenance = Get-Content $provenanceFile -Raw | ConvertFrom-Json
        $actual = Get-SdkHash -Path $sdk

        if ($actual -eq $provenance.vendored.treeSha256) {
            Write-Host "OK   $($dir.Name): SDK $($provenance.sdkVersion) at $($provenance.source.ref)"
        } else {
            Write-Host "FAIL $($dir.Name): sdk/ does not match its recorded hash" -ForegroundColor Red
            Write-Host "     recorded $($provenance.vendored.treeSha256)"
            Write-Host "     actual   $actual"
            Write-Host "     Somebody has edited sdk/ in place. Re-sync from upstream," -ForegroundColor Yellow
            Write-Host "     taking the change with it -- an edit that lives only here is lost" -ForegroundColor Yellow
            Write-Host "     at the next sync, and invisible until then." -ForegroundColor Yellow
            $bad++
        }
    }

    if ($bad) { exit 1 }
    exit 0
}

# -- Sync ----------------------------------------------------------------------

if (-not $Source) {
    throw 'Give -Source (the SDK folder to copy from), or -Verify to check the current copies.'
}

$Source = (Resolve-Path $Source).Path
if (-not (Test-Path (Join-Path $Source 'index.js'))) {
    throw "$Source does not look like the SDK: no index.js in it."
}

# What the source says about itself. Read from the code rather than passed in,
# because a version typed by hand is a version that can be wrong.
$indexText = Get-Content (Join-Path $Source 'index.js') -Raw
$sdkVersion = [regex]::Match($indexText, "SDK_VERSION\s*=\s*'([^']+)'").Groups[1].Value
$apiVersion = [regex]::Match($indexText, "TERMINAL_API_VERSION\s*=\s*'([^']+)'").Groups[1].Value
if (-not $sdkVersion) { throw "Could not read SDK_VERSION from $Source\index.js" }

# Where it came from. A commit is worth having even when it is not a tag: it is
# the difference between "SDK 1.0.0" and a copy anyone can reproduce.
$repository = ''
$refKind = 'unknown'
$committed = ''

Push-Location $Source
try {
    if ((Invoke-Git rev-parse --is-inside-work-tree) -eq 'true') {
        # Stripped of any "user@" the remote carries. A URL written
        # https://uscomrs@github.com/... is a local credential-routing detail --
        # it tells this machine's git helper which account to authenticate as --
        # and it has no business in a file that gets committed and published.
        # Anyone cloning from the recorded URL would be told to authenticate as
        # somebody else.
        $repository = (Invoke-Git remote get-url origin) -replace '^(https?://)[^/@]+@', '$1'
        $committed = Invoke-Git log -1 --format=%cI

        if (-not $Ref) {
            # A tag is the ref worth recording; a commit is what is honestly
            # available before the SDK has releases of its own.
            $tag = Invoke-Git describe --tags --exact-match
            if ($tag) {
                $Ref = $tag; $refKind = 'tag'
            } else {
                $Ref = Invoke-Git rev-parse HEAD; $refKind = 'commit'
            }
        } else {
            $refKind = 'tag'
        }

        # Scoped to the SDK folder. Whether something unrelated elsewhere in the
        # source repository is uncommitted is none of this script's business,
        # and refusing over it would make the check something people work around
        # rather than something they trust.
        if (Invoke-Git status --porcelain -- .) {
            Write-Host 'The SDK folder has uncommitted changes, so the copy would match no' -ForegroundColor Yellow
            Write-Host 'commit -- which is exactly the state this script exists to prevent.' -ForegroundColor Yellow
            throw 'Commit the SDK first, then sync.'
        }
    } else {
        Write-Host 'The source is not in a git repository, so the copy records no commit.' -ForegroundColor Yellow
        Write-Host 'The hash still identifies it, but nobody can fetch it back.' -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}

if (-not $Ref) { $Ref = 'unknown' }

foreach ($dir in Get-TargetModules) {
    $sdk = Join-Path $dir.FullName 'sdk'

    Write-Host "$($dir.Name): replacing sdk/ with $Source"
    Remove-Item -Path $sdk -Recurse -Force
    Copy-Item -Path $Source -Destination $sdk -Recurse

    # Never carried across. It describes the copy, not the source, and copying it
    # would assert a hash that was computed somewhere else.
    $stale = Join-Path $sdk 'SDK-VERSION.json'
    if (Test-Path $stale) { Remove-Item $stale -Force }

    $hash = Get-SdkHash -Path $sdk

    # Where to find this script, said so that somebody in THIS folder can act on
    # it. "tools/sync-sdk.ps1" is only true inside bpplus-redcap; written into a
    # consumer it names a path that does not exist there, and utas has a tools/
    # holding something else, which makes the missing file look mislaid rather
    # than never present.
    $inThisRepo = -not $Consumer
    $syncCommand = if ($inThisRepo) {
        "tools/sync-sdk.ps1 -Module $($dir.Name) -Verify"
    } else {
        "<a checkout of $SyncRepo>/tools/sync-sdk.ps1 -Consumer <this folder> -Verify"
    }

    # The command somebody here can actually run, if this project checks its own
    # copy. That is the one worth naming first: it needs no other repository and
    # no PowerShell.
    $localCheck = $null
    foreach ($candidate in @('test/check-sdk.mjs', 'test/smoke.mjs')) {
        if (Test-Path (Join-Path $dir.FullName $candidate)) {
            $localCheck = "node $candidate"
            break
        }
    }

    $comment = @(
        'Provenance for the vendored copy of the BP+ JavaScript SDK in this folder.',
        '',
        'sdk/ is a COPY. It is developed at the repository named in source.repository',
        'and changed there, never here: an edit made in this folder is lost the next',
        'time it is replaced, and invisible until then.'
    )
    if ($localCheck) {
        $comment += @('', "Check this copy:  $localCheck")
    }
    $comment += @(
        '',
        'Replace this copy, or check it without a local test:',
        "  $syncCommand",
        "The script lives in $SyncRepo, not in this repository."
    )

    $provenance = [ordered]@{
        '$comment'         = $comment
        sdkVersion         = $sdkVersion
        terminalApiVersion = $apiVersion
        source             = [ordered]@{
            repository = $repository
            path       = 'sdk/'
            ref        = $Ref
            refKind    = $refKind
            committed  = $committed
        }
        vendored           = [ordered]@{
            on         = (Get-Date -Format 'yyyy-MM-dd')
            treeSha256 = $hash
        }
    }

    $json = $provenance | ConvertTo-Json -Depth 6
    # LF, to match .gitattributes -- otherwise every checkout shows this file as
    # changed, and the hash it records becomes untrustworthy by association.
    [System.IO.File]::WriteAllText(
        (Join-Path $sdk 'SDK-VERSION.json'),
        ($json -replace "`r`n", "`n") + "`n")

    Write-Host "  SDK $sdkVersion, Terminal API $apiVersion, at $Ref"
    Write-Host "  $hash"
}

Write-Host ''
# The same fault as the manifest used to have: a path that is only true inside
# this repository, printed to somebody who may be standing in another one. Each
# target says what to run where it actually lives.
Write-Host ''
Write-Host 'Now run each project''s own check -- they verify the SDK against what was just recorded:' -ForegroundColor Cyan
foreach ($dir in Get-TargetModules) {
    $shown = if ($Consumer) { $dir.FullName } else { "modules/$($dir.Name)" }
    $check = @('test/check-sdk.mjs', 'test/smoke.mjs') |
        Where-Object { Test-Path (Join-Path $dir.FullName $_) } |
        Select-Object -First 1

    if ($check) { Write-Host "  cd $shown; node $check" }
    else        { Write-Host "  $shown has no local check -- re-run this script with -Verify" }
}
