---
title: "Windows Version 取得の際に 6.2 になる"
categories: [windows]
tags: ["windows"]
date: 2026-02-18 18:30:12 +0900
toc: true
---

# Windows Version 取得の際に 6.2 になる

## 問題

下記のようなコードを考えます。

```cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TestCosnoleApp
{
    [System.Runtime.InteropServices.StructLayout(
        System.Runtime.InteropServices.LayoutKind.Sequential)]
    public struct OSVERSIONINFO
    {
        public int dwOSVersionInfoSize;
        public int dwMajorVersion;
        public int dwMinorVersion;
        public int dwBuildNumber;
        public int dwPlatformId;
        [System.Runtime.InteropServices.MarshalAs(
            System.Runtime.InteropServices.UnmanagedType.ByValTStr,
            SizeConst = 128)]
        public string szCSDVersion;
    }

    //Windows 2000以降は、OSVERSIONINFOEXも使える
    [System.Runtime.InteropServices.StructLayout(
        System.Runtime.InteropServices.LayoutKind.Sequential)]
    public struct OSVERSIONINFOEX
    {
        public uint dwOSVersionInfoSize;
        public uint dwMajorVersion;
        public uint dwMinorVersion;
        public uint dwBuildNumber;
        public uint dwPlatformId;
        [System.Runtime.InteropServices.MarshalAs(
            System.Runtime.InteropServices.UnmanagedType.ByValTStr,
            SizeConst = 128)]
        public string szCSDVersion;
        public short wServicePackMajor;
        public short wServicePackMinor;
        public short wSuiteMask;
        public byte wProductType;
        public byte wReserved;
    }

    internal class Program
    {
        [System.Runtime.InteropServices.DllImport("kernel32.dll")]
        public static extern bool GetVersionEx(ref OSVERSIONINFOEX osvi);

        static void Main(string[] args)
        {
            OSVERSIONINFOEX osvi = new OSVERSIONINFOEX();
            osvi.dwOSVersionInfoSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(osvi);
            GetVersionEx(ref osvi);

            // メジャーバージョン番号
            Console.WriteLine("Major Version: " + osvi.dwMajorVersion);
            //マイナーバージョン番号
            Console.WriteLine("Minor Version: " + osvi.dwMinorVersion);
            //ビルド番号
            Console.WriteLine("Build Number: " + osvi.dwBuildNumber);
            //PlatformId
            Console.WriteLine("PlatformId: " + osvi.dwPlatformId);
            //サービスパック
            Console.WriteLine("ServicePack: " + osvi.szCSDVersion);
            //0:ワークステーション 1:ドメインコントローラ 2:サーバー
            Console.WriteLine("Product Type(0: WorkStation, 1: Domain Controller, 2: Server): " + osvi.wProductType);
            //製品スイートを示すビットフラグ(Enterprise、BackOffice、Terminalなど)
            Console.WriteLine("SuiteMask: " + osvi.wSuiteMask);
        }
    }
}
```

このコードを私の環境（Windows 11）で実行すると、下記の結果が得られます。

```
Major Version: 6
Minor Version: 2
Build Number: 9200
PlatformId: 2
ServicePack:
Product Type(0: WorkStation, 1: Domain Controller, 2: Server): 1
SuiteMask: 768
```

このバージョンは Windows 8 と同じバージョンである 6.2 となっています。

## 原因

これは Windows 8 以前との互換性維持のために発生する問題であり、マニフェストファイルにて Windows 8.1 以降に対応している明示的な記述が無い場合、Windows 10 以降のバージョンであっても 6.2 として返ってきてしまうようです。

## 対策

マニフェストファイルにて、サポートしている OS バージョンを明示してみましょう。`app.manifest` ファイルをプロジェクトに追加し、下記の内容を記述します。

```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="MyApplication.app"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <!-- UAC マニフェスト オプション
             Windows のユーザー アカウント制御のレベルを変更するには、
             requestedExecutionLevel ノードを以下のいずれかで置換します。

        <requestedExecutionLevel  level="asInvoker" uiAccess="false" />
        <requestedExecutionLevel  level="requireAdministrator" uiAccess="false" />
        <requestedExecutionLevel  level="highestAvailable" uiAccess="false" />

            requestedExecutionLevel 要素を指定すると、ファイルおよびレジストリの仮想化が無効にされます。
            アプリケーションが下位互換性を保つためにこの仮想化を要求する場合、この要素を
            削除します。
        -->
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>

  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- このアプリケーションがテストされ、動作するよう設計された Windows バージョンの
           一覧。適切な要素をコメント解除すると、最も互換性のある環境を Windows が
           自動的に選択します。-->

      <!-- Windows Vista -->
      <!--<supportedOS Id="{e2011457-1546-43c5-a5fe-008deee3d3f0}" />-->

      <!-- Windows 7 -->
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}" />

      <!-- Windows 8 -->
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}" />

      <!-- Windows 8.1 -->
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}" />

      <!-- Windows 10 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />

    </application>
  </compatibility>

  <!-- アプリケーションが DPI 対応であり、Windows によってそれ以上の DPI には自動的に拡大縮小されないことを
       示します。Windows Presentation Foundation (WPF) アプリケーションは自動的に DPI に対応し、オプトインする必要は
       ありません。さらに、この設定にオプトインする .NET Framework 4.6 を対象とする Windows フォーム アプリケーションは、
       app.config ファイルで 'EnableWindowsFormsHighDpiAutoResizing' 設定を 'true' に設定する必要があります。
       
       アプリケーションを長いパス対応にします。https://docs.microsoft.com/windows/win32/fileio/maximum-file-path-limitation をご覧ください -->
  <!--
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
  -->

  <!-- Windows のコモン コントロールとダイアログのテーマを有効にします (Windows XP 以降) -->
  <!--
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
          type="win32"
          name="Microsoft.Windows.Common-Controls"
          version="6.0.0.0"
          processorArchitecture="*"
          publicKeyToken="6595b64144ccf1df"
          language="*"
        />
    </dependentAssembly>
  </dependency>
  -->

</assembly>
```

結果として、上記のプログラムは下記の結果を返すようになりました。

```
Major Version: 10
Minor Version: 0
Build Number: 26200
PlatformId: 2
ServicePack:
Product Type(0: WorkStation, 1: Domain Controller, 2: Server): 1
SuiteMask: 768
```

Build Number が 26200 となっており、Windows 11 25H2 であることが分かります。

## 出展
Windows Internals 第7版

