@echo off
setlocal enabledelayedexpansion
set "file=src\pages\ApprovalsPage.tsx"
set "line=122"
for /f "tokens=*" %%l in ('more +%line% "%file%"') do (
    echo %%l
    set /a line+=1
    if !line! gtr 148 goto :eof
)
endlocal