/* Runlet — optional native Windows shell (C# / WinForms + WebView2).
 *
 * The VISUAL part here is native: the OS window, its title bar, the menu strip
 * and the file dialogs are real Win32 controls. The renderer inside WebView2 is
 * the exact same app/ (HTML + CSS + SVG icons + CodeMirror) used by Electron.
 * A small Node helper (scripts/serve.mjs) still provides Live Server, the
 * Python analysis bridge and the REST API token — it is hidden, not a window.
 *
 * This is a starting point, not a drop-in replacement: build it on Windows
 * with .NET 8 SDK + WebView2 Runtime. It cannot be compiled in the Linux
 * sandbox where the main project is developed, so it is kept optional. */

using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace Runlet.Native;

internal static class Program
{
    internal const int Port = 4173;
    private static Process? _server;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainWindow());
        StopServer();
    }

    internal static string FindRoot()
    {
        var fromEnv = Environment.GetEnvironmentVariable("RUNLET_ROOT");
        if (!string.IsNullOrEmpty(fromEnv) && File.Exists(Path.Combine(fromEnv, "app", "index.html")))
            return fromEnv;
        DirectoryInfo? dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "app", "index.html"))) return dir.FullName;
            dir = dir.Parent;
        }
        return Directory.GetCurrentDirectory();
    }

    internal static void StartServer(string root)
    {
        var psi = new ProcessStartInfo("node", "scripts/serve.mjs")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.Environment["PORT"] = Port.ToString();
        psi.Environment["HOST"] = "127.0.0.1";
        try
        {
            _server = Process.Start(psi);
            _server?.BeginOutputReadLine();
            _server?.BeginErrorReadLine();
        }
        catch (Exception e)
        {
            MessageBox.Show("Не удалось запустить Node-помощник: " + e.Message +
                            "\nУстановите Node.js 20+ и соберите проект (npm run build).",
                            "Runlet", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private static void StopServer()
    {
        try { if (_server is { HasExited: false }) _server.Kill(true); } catch { /* already gone */ }
    }
}

internal sealed class MainWindow : Form
{
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };

    public MainWindow()
    {
        Text = "Runlet — редактор сайтов";
        Width = 1680; Height = 1020; MinimumSize = new System.Drawing.Size(1100, 700);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = System.Drawing.Color.FromArgb(16, 23, 34);

        // Real native menu — same command ids as electron/main.cjs and #menuBar.
        var menu = new MenuStrip();
        menu.Items.Add(BuildMenu("Файл",
            ("Новый проект", "startScreen"), ("Новый HTML-файл", "quickNewHtml"),
            ("Открыть файл…", "upload"), ("Сохранить", "save"),
            ("Сохранить проект на диск", "saveToDisk")));
        menu.Items.Add(BuildMenu("Правка",
            ("Отменить", "undo"), ("Повторить", "redo"),
            ("Форматировать", "format"), ("Развернуть весь код", "unfoldAll")));
        menu.Items.Add(BuildMenu("Вид",
            ("Режим редактора / классический вид", "focusMode"),
            ("Показать сайт рядом с кодом", "previewSplit"),
            ("Проводник", "toggleSidebar"),
            ("Развернуть все панели", "restorePanes"),
            ("Настройки", "settings")));
        menu.Items.Add(BuildMenu("Запуск",
            ("Запустить / обновить страницу", "run"),
            ("Анализ кода", "analyze"),
            ("Открыть в браузере", "openSiteExternal"),
            ("Live Server", "liveServer")));
        menu.Items.Add(BuildMenu("Справка",
            ("Как работать", "helpWelcome"), ("Горячие клавиши", "shortcuts")));
        MainMenuStrip = menu;
        Controls.Add(_web);
        Controls.Add(menu);

        Shown += async (_, _) =>
        {
            var root = Program.FindRoot();
            Program.StartServer(root);
            await _web.EnsureCoreWebView2Async();
            _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _web.Source = new Uri($"http://127.0.0.1:{Program.Port}/");
        };
    }

    private ToolStripMenuItem BuildMenu(string title, params (string label, string command)[] items)
    {
        var root = new ToolStripMenuItem(title);
        foreach (var (label, command) in items)
        {
            var item = new ToolStripMenuItem(label);
            item.Click += async (_, _) =>
            {
                if (_web.CoreWebView2 == null) return;
                // command ids are hard-coded above; no user input reaches JS.
                await _web.CoreWebView2.ExecuteScriptAsync(
                    $"window.Runlet?.runCommand('{command}')");
            };
            root.DropDownItems.Add(item);
        }
        return root;
    }
}
