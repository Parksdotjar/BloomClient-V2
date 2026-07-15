using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BloomReleaseManager;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        try
        {
            var repoIndex = Array.IndexOf(args, "--repo");
            var argumentRepo = repoIndex >= 0 && repoIndex + 1 < args.Length
                ? string.Join(" ", args.Skip(repoIndex + 1))
                : null;
            var environmentRepo = Environment.GetEnvironmentVariable("BLOOM_RELEASE_REPO");
            var repo = Path.GetFullPath((argumentRepo ?? environmentRepo ??
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..")).Trim('"'));

            if (!File.Exists(Path.Combine(repo, "VERSION")))
                throw new DirectoryNotFoundException($"Bloom Client was not found at:\n{repo}");

            Application.Run(new ReleaseManagerForm(repo));
        }
        catch (Exception error)
        {
            MessageBox.Show(
                error.Message,
                "Bloom Release Manager could not start",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}

internal sealed class ReleaseManagerForm : Form
{
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr handle, int message, int wParam, int lParam);
    private static readonly Color Accent = Color.FromArgb(142, 227, 101);
    private readonly string repo;
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private int major;
    private int minor;
    private int patch;
    private string releaseNotes = "";
    private bool autoPublish = true;
    private bool running;
    private bool webReady;

    public ReleaseManagerForm(string repoPath)
    {
        repo = repoPath;
        LoadVersion();
        Text = "Bloom Release Manager";
        ClientSize = new Size(1220, 780);
        MinimumSize = new Size(960, 640);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(5, 7, 7);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        FormBorderStyle = FormBorderStyle.None;
        Controls.Add(web);
        Shown += async (_, _) => await InitializeWebAsync();
    }

    private async Task InitializeWebAsync()
    {
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BloomReleaseManager", "WebView2"));
        await web.EnsureCoreWebView2Async(environment);
        web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        web.CoreWebView2.SetVirtualHostNameToFolderMapping("bloom.owner", Path.Combine(AppContext.BaseDirectory, "ui"), CoreWebView2HostResourceAccessKind.DenyCors);
        web.CoreWebView2.WebMessageReceived += WebMessageReceived;
        web.CoreWebView2.NavigationCompleted += (_, _) => { webReady = true; PushState(); };
        web.Source = new Uri("https://bloom.owner/index.html");
    }

    private async void WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;
            var action = root.GetProperty("action").GetString();
            switch (action)
            {
                case "drag": ReleaseCapture(); SendMessage(Handle, 0xA1, 0x2, 0); break;
                case "minimize": WindowState = FormWindowState.Minimized; break;
                case "maximize": WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
                case "close": Close(); break;
                case "version":
                    major = Math.Clamp(root.GetProperty("major").GetInt32(), 0, 999);
                    minor = Math.Clamp(root.GetProperty("minor").GetInt32(), 0, 999);
                    patch = Math.Clamp(root.GetProperty("patch").GetInt32(), 0, 999);
                    PushState();
                    break;
                case "publish":
                    major = Math.Clamp(root.GetProperty("major").GetInt32(), 0, 999);
                    minor = Math.Clamp(root.GetProperty("minor").GetInt32(), 0, 999);
                    patch = Math.Clamp(root.GetProperty("patch").GetInt32(), 0, 999);
                    releaseNotes = root.GetProperty("notes").GetString() ?? "";
                    autoPublish = root.GetProperty("autoPublish").GetBoolean();
                    await PublishAsync();
                    break;
            }
        }
        catch (Exception error) { ShowResult("Something went wrong", error.Message, true); }
    }

    private void PushState() => RunScript($"window.bloom?.setState({JsonSerializer.Serialize(new { major, minor, patch, running })})");
    private void SetBusy(bool value) { running = value; RunScript($"window.bloom?.setBusy({value.ToString().ToLowerInvariant()})"); }
    private void SetStatus(string message, string tone = "muted") => RunScript($"window.bloom?.setStatus({JsonSerializer.Serialize(message)}, {JsonSerializer.Serialize(tone)})");
    private void ClearTerminal() => RunScript("window.bloom?.clearTerminal()");
    private void ShowResult(string title, string message, bool error = false) => RunScript($"window.bloom?.showResult({JsonSerializer.Serialize(title)}, {JsonSerializer.Serialize(message)}, {error.ToString().ToLowerInvariant()})");
    private void RunScript(string script) { if (!webReady || IsDisposed) return; if (InvokeRequired) { BeginInvoke(() => RunScript(script)); return; } _ = web.ExecuteScriptAsync(script); }

    protected override void WndProc(ref Message message)
    {
        const int WmNcHitTest = 0x84;
        if (message.Msg == WmNcHitTest && WindowState == FormWindowState.Normal)
        {
            base.WndProc(ref message);
            var point = PointToClient(new Point((short)(message.LParam.ToInt64() & 0xffff), (short)((message.LParam.ToInt64() >> 16) & 0xffff)));
            const int edge = 7;
            if (point.X <= edge && point.Y <= edge) message.Result = (IntPtr)13;
            else if (point.X >= ClientSize.Width - edge && point.Y <= edge) message.Result = (IntPtr)14;
            else if (point.X <= edge && point.Y >= ClientSize.Height - edge) message.Result = (IntPtr)16;
            else if (point.X >= ClientSize.Width - edge && point.Y >= ClientSize.Height - edge) message.Result = (IntPtr)17;
            else if (point.X <= edge) message.Result = (IntPtr)10;
            else if (point.X >= ClientSize.Width - edge) message.Result = (IntPtr)11;
            else if (point.Y <= edge) message.Result = (IntPtr)12;
            else if (point.Y >= ClientSize.Height - edge) message.Result = (IntPtr)15;
            return;
        }
        base.WndProc(ref message);
    }

    private async Task PublishAsync()
    {
        if (running) return;
        var tag = CurrentTag();
        var currentTag = File.ReadAllText(Path.Combine(repo, "VERSION")).Trim();
        if (ParseVersion(tag) <= ParseVersion(currentTag))
        {
            ShowResult("Version must increase", $"Choose a version higher than {currentTag} before publishing.", true);
            return;
        }

        SetBusy(true);
        ClearTerminal();
        var versionPrepared = false;
        var releaseCommitted = false;
        try
        {
            Step("Preflight", "Checking repository and GitHub access");
            await MustRun("gh", "auth status");
            await MustRun("git", "fetch origin main --tags");
            var branch = (await CaptureOutput("git", "branch --show-current")).Trim();
            if (branch != "main") throw new InvalidOperationException("The repository must be on the main branch.");
            var dirty = await CaptureOutput("git", "status --porcelain --untracked-files=all");
            if (!string.IsNullOrWhiteSpace(dirty)) throw new InvalidOperationException($"The repository has uncommitted changes:\n{dirty.Trim()}\n\nCommit or discard them before publishing a release.");
            var divergence = (await CaptureOutput("git", "rev-list --left-right --count origin/main...HEAD")).Trim();
            if (divergence != "0\t0" && divergence != "0 0") throw new InvalidOperationException("Local main and origin/main must match before releasing.");
            if (!string.IsNullOrWhiteSpace(await CaptureOutput("git", $"tag -l {Quote(tag)}"))) throw new InvalidOperationException($"Tag {tag} already exists.");

            Step("Version", $"Synchronizing Bloom Client to {tag}");
            versionPrepared = true;
            await File.WriteAllTextAsync(Path.Combine(repo, "VERSION"), tag + Environment.NewLine);
            await MustRun("npm.cmd", "run version:sync");

            Step("Checks", "Running frontend and native validation");
            await MustRun("npm.cmd", "run typecheck");
            await MustRun("npm.cmd", "run build");
            await MustRun("cargo", "test --manifest-path src-tauri/Cargo.toml");

            Step("Git", "Committing and pushing the release version");
            await MustRun("git", "add VERSION package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json");
            await MustRun("git", $"commit -m {Quote($"Release {tag}")}");
            releaseCommitted = true;
            await MustRun("git", "push origin main");
            await MustRun("git", $"tag -a {Quote(tag)} -m {Quote($"Bloom Client {tag}")}");
            await MustRun("git", $"push origin {Quote(tag)}");

            Step("GitHub", "Waiting for the signed Windows build to start");
            var runId = await FindReleaseRun(tag);
            if (runId == 0) throw new InvalidOperationException("The GitHub release workflow did not start within two minutes.");
            await WaitForReleaseRun(runId);

            Step("Release", "Applying release notes");
            var notesPath = Path.Combine(Path.GetTempPath(), $"bloom-release-{Guid.NewGuid():N}.md");
            await File.WriteAllTextAsync(notesPath, string.IsNullOrWhiteSpace(releaseNotes) ? $"Bloom Client {tag}" : releaseNotes.Trim());
            try
            {
                await MustRun("gh", $"release edit {Quote(tag)} --notes-file {Quote(notesPath)}");
                if (autoPublish) await MustRun("gh", $"release edit {Quote(tag)} --draft=false");
            }
            finally { File.Delete(notesPath); }

            Step("Complete", autoPublish ? $"{tag} is live and available to Bloom clients" : $"{tag} is ready as a draft release");
            SetStatus(autoPublish ? "Release published successfully" : "Draft release created successfully", "success");
            ShowResult("Release complete", $"Bloom Client {tag} completed successfully.");
        }
        catch (Exception error)
        {
            if (versionPrepared && !releaseCommitted)
            {
                Log("\n[ROLLBACK] Restoring the incomplete version bump so this release can be retried.\n", Color.FromArgb(210, 174, 109));
                await RunProcess(
                    "git",
                    "restore -- VERSION package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json",
                    true
                );
            }
            Log($"\nERROR: {error.Message}\n", Color.FromArgb(241, 103, 103));
            SetStatus("Release stopped — review the terminal", "error");
            ShowResult("Release stopped", error.Message, true);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task<long> FindReleaseRun(string tag)
    {
        for (var attempt = 0; attempt < 24; attempt++)
        {
            var json = await CaptureOutput("gh", "run list --workflow release.yml --event push --limit 20 --json databaseId,headBranch");
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
            foreach (var run in document.RootElement.EnumerateArray())
                if (run.GetProperty("headBranch").GetString() == tag) return run.GetProperty("databaseId").GetInt64();
            await Task.Delay(5000);
        }
        return 0;
    }

    private async Task WaitForReleaseRun(long runId)
    {
        var reported = new Dictionary<string, string>();
        for (var attempt = 0; attempt < 675; attempt++)
        {
            var json = await CaptureOutput("gh", $"run view {runId} --json status,conclusion,jobs,url");
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            foreach (var job in root.GetProperty("jobs").EnumerateArray())
            {
                foreach (var step in job.GetProperty("steps").EnumerateArray())
                {
                    var name = step.GetProperty("name").GetString() ?? "GitHub step";
                    var statusValue = step.GetProperty("status").GetString() ?? "pending";
                    var conclusion = step.GetProperty("conclusion").GetString() ?? "";
                    var state = statusValue == "completed" && !string.IsNullOrWhiteSpace(conclusion) ? conclusion : statusValue;
                    if (reported.TryGetValue(name, out var previous) && previous == state) continue;
                    reported[name] = state;
                    var color = state == "success" ? Accent : state == "failure" ? Color.FromArgb(241, 103, 103) : Color.FromArgb(183, 197, 192);
                    Log($"[GitHub] {name}: {state}\n", color);
                }
            }

            var runStatus = root.GetProperty("status").GetString();
            if (runStatus == "completed")
            {
                var runConclusion = root.GetProperty("conclusion").GetString();
                if (runConclusion != "success") throw new InvalidOperationException($"The GitHub build finished with status: {runConclusion ?? "unknown"}.");
                Log("[GitHub] Signed installer build completed successfully.\n", Accent);
                return;
            }
            await Task.Delay(4000);
        }
        throw new TimeoutException("The GitHub build did not finish within 45 minutes.");
    }

    private async Task MustRun(string file, string arguments)
    {
        var result = await RunProcess(file, arguments, true);
        if (result.ExitCode != 0) throw new InvalidOperationException($"{file} stopped with exit code {result.ExitCode}.");
    }

    private async Task<string> CaptureOutput(string file, string arguments)
    {
        var result = await RunProcess(file, arguments, false);
        if (result.ExitCode != 0) throw new InvalidOperationException($"{file} stopped with exit code {result.ExitCode}.\n{result.Error}");
        return result.Output;
    }

    private async Task<ProcessResult> RunProcess(string file, string arguments, bool stream)
    {
        if (stream) Log($"> {file} {arguments}\n", Accent);
        var executable = file;
        var processArguments = arguments;
        if (file.Equals("npm.cmd", StringComparison.OrdinalIgnoreCase))
        {
            var nodeRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs");
            var systemNode = Path.Combine(nodeRoot, "node.exe");
            var npmCli = Path.Combine(nodeRoot, "node_modules", "npm", "bin", "npm-cli.js");
            if (!File.Exists(systemNode) || !File.Exists(npmCli)) throw new FileNotFoundException("The system Node.js/npm installation could not be found.", npmCli);
            executable = systemNode;
            processArguments = $"{Quote(npmCli)} {arguments}";
        }
        else if (file.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".bat", StringComparison.OrdinalIgnoreCase))
        {
            executable = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
            processArguments = $"/d /s /c \"\"{file}\" {arguments}\"";
        }
        var info = new ProcessStartInfo(executable, processArguments)
        {
            WorkingDirectory = repo,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        var process = new Process { StartInfo = info };
        var output = new StringBuilder();
        var error = new StringBuilder();
        process.OutputDataReceived += (_, eventArgs) => { if (eventArgs.Data is null) return; output.AppendLine(eventArgs.Data); if (stream) Log(eventArgs.Data + "\n", Color.FromArgb(183, 197, 192)); };
        process.ErrorDataReceived += (_, eventArgs) => { if (eventArgs.Data is null) return; error.AppendLine(eventArgs.Data); if (stream) Log(eventArgs.Data + "\n", Color.FromArgb(210, 174, 109)); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();
        return new ProcessResult(process.ExitCode, output.ToString(), error.ToString());
    }

    private void LoadVersion()
    {
        var raw = File.ReadAllText(Path.Combine(repo, "VERSION")).Trim().TrimStart('v', 'V');
        var parts = raw.Split('.').Select(value => int.TryParse(value, out var number) ? number : 0).ToArray();
        major = parts.ElementAtOrDefault(0);
        minor = parts.ElementAtOrDefault(1);
        patch = parts.ElementAtOrDefault(2);
    }

    private string CurrentTag() => $"v{major}.{minor}.{patch}";
    private static Version ParseVersion(string value) => Version.Parse(value.Trim().TrimStart('v', 'V'));
    private void Step(string title, string message) { SetStatus(message); Log($"\n[{title.ToUpperInvariant()}] {message}\n", Accent); }
    private void Log(string message, Color color) { RunScript($"window.bloom?.appendLog({JsonSerializer.Serialize(message)}, {JsonSerializer.Serialize($"#{color.R:x2}{color.G:x2}{color.B:x2}")})"); }
    private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";

    private sealed record ProcessResult(int ExitCode, string Output, string Error);
}
