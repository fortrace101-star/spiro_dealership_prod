@echo off
cd /d "c:\Users\manue\Desktop\spiro\pos"
node node_modules\typescript\bin\tsc --noEmit > tsc-rev.txt 2>&1
echo DONE > tsc-rev-done.txt