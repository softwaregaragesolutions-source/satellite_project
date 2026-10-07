@echo off
setlocal
echo ======================================================================
echo  AERO-SAT ONE - GITHUB REPOSITORY SYNC
echo  Target: https://github.com/softwaregaragesolutions-source/satellite_project
echo ======================================================================
echo.
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\cmd;%PATH%"

git remote set-url origin https://github.com/softwaregaragesolutions-source/satellite_project.git
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Repository successfully pushed to GitHub!
) else (
    echo.
    echo [NOTE] If prompted for authentication:
    echo   Username: softwaregaragesolutions-source
    echo   Password: Use your GitHub Personal Access Token (classic token with 'repo' scope)
    echo   Generate a token at: https://github.com/settings/tokens
)

echo.
pause
