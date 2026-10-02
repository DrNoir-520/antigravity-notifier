' scripts/run-hidden.vbs
' Launches Antigravity Notifier in completely hidden mode (0 window, no console popup).
' English comments only.

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

Dim objShell
Set objShell = CreateObject("WScript.Shell")

command = "node """ & projectDir & "\bin\notifier.js"" daemon"
objShell.Run command, 0, False

Set objShell = Nothing
Set fso = Nothing
