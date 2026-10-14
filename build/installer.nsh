; Technically Not · build/installer.nsh — electron-builder NSIS hooks (picked up from build/ automatically).
; Builds made before the rename installed under %LOCALAPPDATA%\Programs\ARQ\…. nsis.guid stayed the same so updates replace that
; install, and electron-builder reuses the install folder recorded for that guid, so every update went back into ...\ARQ. This moves
; such an install to the default folder (Programs\TechnicallyNot.ai), for manual installs and silent updates alike:
;  - customInit (before any page shows or re-reads it) repoints the recorded InstallLocation and $INSTDIR to the default folder, and
;    remembers the old folder in TnaiOldInstall, so a cancelled install still cleans up on the next run;
;  - the old uninstaller still runs as usual (shortcuts are recreated for the new folder);
;  - customInstall, once the new files are in place, deletes the old folder and the ARQ folder above it if that is then empty.
!ifndef BUILD_UNINSTALLER
  Var tnaiOldInstall

  ; $R0 in: a folder path. $R0 out: "1" when a path segment is named ARQ (StrCmp ignores case), else "".
  Function tnaiIsLegacyDir
    Push $R1
    Push $R2
    StrCpy $R0 "$R0\"
    StrCpy $R1 0
    loop:
      StrCpy $R2 $R0 5 $R1
      StrCmp $R2 "" no
      StrCmp $R2 "\ARQ\" yes
      IntOp $R1 $R1 + 1
      Goto loop
    yes:
      StrCpy $R0 "1"
      Goto done
    no:
      StrCpy $R0 ""
    done:
    Pop $R2
    Pop $R1
  FunctionEnd

  !macro customInit
    ReadRegStr $tnaiOldInstall HKCU "${INSTALL_REGISTRY_KEY}" TnaiOldInstall
    ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $R0 != ""
      StrCpy $R3 $R0
      Call tnaiIsLegacyDir
      ${if} $R0 == "1"
        StrCpy $tnaiOldInstall $R3
        WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" TnaiOldInstall $R3
        WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\${APP_FILENAME}"
        ${if} $installMode == "CurrentUser"
          StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
        ${endif}
        ; /D= still wins, as in electron-builder's own setInstallModePerUser
        !insertmacro GetDParameter $R0
        ${if} $R0 != ""
          StrCpy $INSTDIR $R0
        ${endif}
      ${endif}
    ${endif}
  !macroend

  ; One copy per PC: skip the "Only for me / Anyone using this computer" page. A PC that already has an all-users copy keeps
  ; updating that one (electron-builder only removes the per-user copy when installing for all users, never the other way round);
  ; otherwise it's always the per-user copy. So any later installer, run by hand or by the updater, overwrites the one install.
  !macro customInstallMode
    ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $R0 != ""
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  !macroend

  ; Welcome page that says whether this install is new or replaces the copy already on the PC (same guid = same app entry, so
  ; the installer always updates the one install in place). Silent/auto updates show no pages, so this only affects manual runs.
  ; Defined inside the macro: installer.nsh is included before LogicLib/isUpdated exist, so a top-level Function using ${if} fails to compile.
  !macro customWelcomePage
    Var tnaiWelcomeText

    Function tnaiWelcomePre
      ${if} ${isUpdated}
        Abort
      ${endif}
      ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
      ${if} $R0 == ""
        ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
      ${endif}
      ${if} $R0 == ""
        StrCpy $tnaiWelcomeText "Setup will install Technically Not ${VERSION} on this computer.$\r$\n$\r$\nClick Next to continue."
      ${elseif} $R0 == "${VERSION}"
        StrCpy $tnaiWelcomeText "Technically Not ${VERSION} is already installed on this computer.$\r$\n$\r$\nSetup will reinstall it over the existing copy. It does not add a second copy. Your projects, settings and sign-ins are kept.$\r$\n$\r$\nClick Next to continue."
      ${else}
        StrCpy $tnaiWelcomeText "Technically Not $R0 is installed on this computer.$\r$\n$\r$\nSetup will update it to version ${VERSION}. The old version is replaced, not kept as a second copy. Your projects, settings and sign-ins are kept.$\r$\n$\r$\nClick Next to continue."
      ${endif}
    FunctionEnd

    !define MUI_WELCOMEPAGE_TITLE "Welcome to Technically Not Setup"
    !define MUI_WELCOMEPAGE_TEXT "$tnaiWelcomeText"
    !define MUI_PAGE_CUSTOMFUNCTION_PRE tnaiWelcomePre
    !insertmacro MUI_PAGE_WELCOME
  !macroend

  !macro customInstall
    ${if} $tnaiOldInstall != ""
    ${andIf} $tnaiOldInstall != $INSTDIR
      StrCpy $R0 $tnaiOldInstall
      Call tnaiIsLegacyDir
      ${if} $R0 == "1"
        RMDir /r $tnaiOldInstall
        ; the ARQ folder above it, only when nothing else is left in it
        Push $tnaiOldInstall
        Call GetFileParent
        Pop $R0
        StrCpy $R1 $R0 4 -4
        ${if} $R1 == "\ARQ"
          RMDir $R0
        ${endif}
      ${endif}
    ${endif}
    DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" TnaiOldInstall
  !macroend
!endif
