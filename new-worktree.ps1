param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Branch
)

# Check if branch exists locally
$localBranch = git branch --list $Branch
if (-not $localBranch) {
  Write-Host "Branch '$Branch' not found locally, fetching..."
  git fetch origin
  $remoteBranch = git branch -r --list "origin/$Branch"
  if (-not $remoteBranch) {
    Write-Error "Branch '$Branch' does not exist locally or remotely."
    exit 1
  }
}

git worktree add "../$Name" $Branch
Set-Location "../$Name"
npm install
