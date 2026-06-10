@echo off
title Free port 3001
echo Finding process using port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
    echo Killing PID %%a
    taskkill /PID %%a /F
    goto :done
)
echo No process found listening on port 3001.
:done
echo Done. You can run "start app" again.
pause
