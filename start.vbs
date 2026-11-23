Option Explicit
' 키친앤코 블로그 스튜디오 실행 (검은 창 없이 실행)
Dim shell, fso, folder, result, urlFile, url, reader
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
If Not fso.FileExists(fso.BuildPath(folder, "launcher.js")) Or Not fso.FileExists(fso.BuildPath(folder, "server.js")) Then
  MsgBox "Program files missing. Extract the whole ZIP first.", vbCritical, "KITCHEN&KO STUDIO"
  WScript.Quit 1
End If
On Error Resume Next
result = shell.Run("cmd.exe /d /c node --version >nul 2>&1", 0, True)
If Err.Number <> 0 Or result <> 0 Then
  MsgBox "Node.js is not installed. Install Node.js LTS from nodejs.org.", vbCritical, "KITCHEN&KO STUDIO"
  WScript.Quit 1
End If
Err.Clear
result = shell.Run("cmd.exe /d /c node launcher.js --from-vbs 1>>launcher.log 2>&1", 0, True)
If Err.Number <> 0 Or result <> 0 Then
  MsgBox "Server failed to start. Run start.bat to see the reason.", vbExclamation, "KITCHEN&KO STUDIO"
  WScript.Quit 1
End If
On Error GoTo 0
urlFile = fso.BuildPath(folder, ".launch-url.txt")
If Not fso.FileExists(urlFile) Then
  MsgBox "Server address not found. Run start.bat.", vbExclamation, "KITCHEN&KO STUDIO"
  WScript.Quit 1
End If
Set reader = fso.OpenTextFile(urlFile, 1, False)
url = Trim(reader.ReadAll)
reader.Close
If Left(url, 17) <> "http://127.0.0.1:" Then WScript.Quit 1
shell.Run url, 1, False
