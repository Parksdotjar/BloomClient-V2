using System.Diagnostics;
using System.ComponentModel;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace BloomReleaseManager;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var repoIndex = Array.IndexOf(args, "--repo");
        var repo = repoIndex >= 0 && repoIndex + 1 < args.Length
            ? args[repoIndex + 1]
            : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        Application.Run(new ReleaseManagerForm(repo));
    }
}

internal sealed class ReleaseManagerForm : Form
{
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr handle, int message, int wParam, int lParam);
    private static readonly Color Background = Color.FromArgb(8, 10, 10);
    private static readonly Color Panel = Color.FromArgb(14, 17, 17);
    private static readonly Color Control = Color.FromArgb(21, 25, 25);
    private static readonly Color Border = Color.FromArgb(43, 49, 49);
    private static readonly Color TextColor = Color.FromArgb(239, 244, 242);
    private static readonly Color Muted = Color.FromArgb(130, 143, 139);
    private static readonly Color Accent = Color.FromArgb(142, 227, 101);
    private readonly string repo;
    private readonly VersionStepper major = new("MAJOR");
    private readonly VersionStepper minor = new("MINOR");
    private readonly VersionStepper patch = new("PATCH");
    private readonly Label versionPreview = new();
    private readonly TextBox releaseNotes = new();
    private readonly RichTextBox terminal = new();
    private readonly Button publish = new BloomButton();
    private readonly CheckBox autoPublish = new BloomCheckBox();
    private readonly Label status = new();
    private bool running;

    public ReleaseManagerForm(string repoPath)
    {
        repo = repoPath;
        Text = "Bloom Release Manager";
        ClientSize = new Size(1180, 760);
        MinimumSize = new Size(980, 660);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Background;
        ForeColor = TextColor;
        Font = new Font("Segoe UI Variable Text", 9F);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        FormBorderStyle = FormBorderStyle.None;
        Padding = new Padding(1);

        var shell = new Panel { Dock = DockStyle.Fill, BackColor = Border, Padding = new Padding(1) };
        var surface = new Panel { Dock = DockStyle.Fill, BackColor = Background };
        shell.Controls.Add(surface);
        Controls.Add(shell);
        var titleBar = BuildTitleBar();
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2, Padding = new Padding(22, 20, 22, 18), BackColor = Background };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 360));
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
        surface.Controls.Add(root);
        surface.Controls.Add(titleBar);
        titleBar.BringToFront();

        root.Controls.Add(BuildControls(), 0, 0);
        root.Controls.Add(BuildTerminal(), 1, 0);
        root.SetColumnSpan(BuildFooter(root), 2);
        LoadVersion();
    }

    private Control BuildTitleBar()
    {
        var bar = new Panel { Dock = DockStyle.Top, Height = 48, BackColor = Color.FromArgb(10, 12, 12) };
        var mark = new PictureBox { Location = new Point(17, 12), Size = new Size(24, 24), SizeMode = PictureBoxSizeMode.Zoom, Image = Icon?.ToBitmap() };
        var title = new Label { Text = "Bloom Release Manager", Location = new Point(51, 8), AutoSize = true, ForeColor = TextColor, Font = new Font("Segoe UI Variable Display", 10F, FontStyle.Bold) };
        var subtitle = new Label { Text = "OWNER TOOL", Location = new Point(52, 27), AutoSize = true, ForeColor = Accent, Font = new Font("Segoe UI", 6.8F, FontStyle.Bold) };
        var close = WindowButton("×");
        var maximize = WindowButton("□");
        var minimize = WindowButton("−");
        close.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        maximize.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        minimize.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        close.Location = new Point(ClientSize.Width - 45, 7);
        maximize.Location = new Point(ClientSize.Width - 84, 7);
        minimize.Location = new Point(ClientSize.Width - 123, 7);
        close.Click += (_, _) => Close();
        maximize.Click += (_, _) => WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
        minimize.Click += (_, _) => WindowState = FormWindowState.Minimized;
        bar.Resize += (_, _) => { close.Left = bar.ClientSize.Width - 40; maximize.Left = bar.ClientSize.Width - 79; minimize.Left = bar.ClientSize.Width - 118; };
        void Drag(object? sender, MouseEventArgs e) { if (e.Button != MouseButtons.Left) return; ReleaseCapture(); SendMessage(Handle, 0xA1, 0x2, 0); }
        bar.MouseDown += Drag; title.MouseDown += Drag; subtitle.MouseDown += Drag;
        bar.DoubleClick += (_, _) => maximize.PerformClick();
        bar.Controls.Add(mark); bar.Controls.Add(title); bar.Controls.Add(subtitle); bar.Controls.Add(minimize); bar.Controls.Add(maximize); bar.Controls.Add(close);
        return bar;
    }

    private Control BuildControls()
    {
        var card = Card();
        card.Padding = new Padding(24);
        var layout = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, BackColor = Panel };
        card.Controls.Add(layout);
        layout.Controls.Add(Heading("OWNER TOOL", "Ship Bloom Client", "Choose the next version and let Bloom handle the complete signed GitHub release."));

        versionPreview.AutoSize = false;
        versionPreview.Size = new Size(310, 64);
        versionPreview.TextAlign = ContentAlignment.MiddleCenter;
        versionPreview.Font = new Font("Segoe UI Variable Display", 22F, FontStyle.Bold);
        versionPreview.ForeColor = Accent;
        versionPreview.BackColor = Color.Transparent;
        versionPreview.Dock = DockStyle.Fill;
        var previewSurface = new RoundedPanel { Width = 310, Height = 64, Radius = 10, BorderColor = Color.FromArgb(35, 43, 41), BackColor = Control, Margin = new Padding(0) };
        previewSurface.Controls.Add(versionPreview);
        layout.Controls.Add(previewSurface);

        var versionGrid = new TableLayoutPanel { Width = 310, Height = 76, ColumnCount = 3, RowCount = 1, Margin = new Padding(0, 14, 0, 0), BackColor = Panel };
        for (var i = 0; i < 3; i++) versionGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33F));
        versionGrid.Controls.Add(major, 0, 0);
        versionGrid.Controls.Add(minor, 1, 0);
        versionGrid.Controls.Add(patch, 2, 0);
        layout.Controls.Add(versionGrid);

        var patchButton = ActionButton("+ Next patch", Accent, Color.FromArgb(14, 20, 13));
        patchButton.Width = 310;
        patchButton.Margin = new Padding(0, 10, 0, 0);
        patchButton.Click += (_, _) => patch.Value++;
        layout.Controls.Add(patchButton);

        var notesLabel = new Label { Text = "RELEASE NOTES", AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI", 8F, FontStyle.Bold), Margin = new Padding(0, 20, 0, 7) };
        layout.Controls.Add(notesLabel);
        releaseNotes.Multiline = true;
        releaseNotes.Dock = DockStyle.Fill;
        releaseNotes.BackColor = Control;
        releaseNotes.ForeColor = TextColor;
        releaseNotes.BorderStyle = BorderStyle.None;
        releaseNotes.Padding = new Padding(3);
        releaseNotes.PlaceholderText = "What changed in this release?";
        var notesSurface = new RoundedPanel { Width = 310, Height = 140, Radius = 10, BorderColor = Border, BackColor = Control, Padding = new Padding(11), Margin = new Padding(0) };
        notesSurface.Controls.Add(releaseNotes);
        layout.Controls.Add(notesSurface);

        autoPublish.Text = "Publish automatically after the build passes";
        autoPublish.Checked = true;
        autoPublish.AutoSize = true;
        autoPublish.ForeColor = TextColor;
        autoPublish.Margin = new Padding(0, 14, 0, 0);
        layout.Controls.Add(autoPublish);
        return card;
    }

    private Control BuildTerminal()
    {
        var card = Card();
        card.Margin = new Padding(14, 0, 0, 0);
        card.Padding = new Padding(18);
        var title = new Label { Text = "LIVE RELEASE OUTPUT", Dock = DockStyle.Top, Height = 32, ForeColor = Muted, Font = new Font("Segoe UI", 8F, FontStyle.Bold) };
        terminal.Dock = DockStyle.Fill;
        terminal.ReadOnly = true;
        terminal.BorderStyle = BorderStyle.None;
        terminal.BackColor = Color.FromArgb(5, 7, 7);
        terminal.ForeColor = Color.FromArgb(183, 197, 192);
        terminal.Font = new Font("Cascadia Mono", 9.25F);
        terminal.DetectUrls = false;
        terminal.Text = "Bloom Release Manager ready.\nNo command windows will be opened.\n\n";
        card.Controls.Add(terminal);
        card.Controls.Add(title);
        return card;
    }

    private Control BuildFooter(TableLayoutPanel root)
    {
        var footer = new Panel { Dock = DockStyle.Fill, Margin = new Padding(2, 12, 0, 0), BackColor = Background };
        status.Text = "Ready to prepare a release";
        status.ForeColor = Muted;
        status.AutoSize = true;
        status.Location = new Point(2, 16);
        publish.Text = "Build and publish release";
        publish.FlatStyle = FlatStyle.Flat;
        publish.BackColor = Accent;
        publish.ForeColor = Color.FromArgb(14, 20, 13);
        publish.Cursor = Cursors.Hand;
        publish.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
        publish.Width = 220;
        publish.Height = 42;
        publish.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        publish.Location = new Point(root.ClientSize.Width - 258, 0);
        footer.Resize += (_, _) => publish.Left = footer.ClientSize.Width - publish.Width;
        publish.Click += async (_, _) => await PublishAsync();
        footer.Controls.Add(status);
        footer.Controls.Add(publish);
        root.Controls.Add(footer, 0, 1);
        return footer;
    }

    private async Task PublishAsync()
    {
        if (running) return;
        var tag = CurrentTag();
        var currentTag = File.ReadAllText(Path.Combine(repo, "VERSION")).Trim();
        if (ParseVersion(tag) <= ParseVersion(currentTag))
        {
            MessageBox.Show($"Choose a version higher than {currentTag} before publishing.", "Version must increase", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (MessageBox.Show(
                $"Publish Bloom Client {tag}?\n\nThis will commit the version bump, push main, create the tag, start the signed GitHub build, and {(autoPublish.Checked ? "publish" : "prepare")} the release.",
                "Confirm Bloom release", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;

        running = true;
        publish.Enabled = false;
        SetInputs(false);
        terminal.Clear();
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
            await File.WriteAllTextAsync(notesPath, string.IsNullOrWhiteSpace(releaseNotes.Text) ? $"Bloom Client {tag}" : releaseNotes.Text.Trim());
            try
            {
                await MustRun("gh", $"release edit {Quote(tag)} --notes-file {Quote(notesPath)}");
                if (autoPublish.Checked) await MustRun("gh", $"release edit {Quote(tag)} --draft=false");
            }
            finally { File.Delete(notesPath); }

            Step("Complete", autoPublish.Checked ? $"{tag} is live and available to Bloom clients" : $"{tag} is ready as a draft release");
            status.Text = autoPublish.Checked ? "Release published successfully" : "Draft release created successfully";
            status.ForeColor = Accent;
            MessageBox.Show($"Bloom Client {tag} completed successfully.", "Release complete", MessageBoxButtons.OK, MessageBoxIcon.Information);
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
            status.Text = "Release stopped — review the terminal";
            status.ForeColor = Color.FromArgb(241, 103, 103);
            MessageBox.Show(error.Message, "Release stopped", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            running = false;
            publish.Enabled = true;
            SetInputs(true);
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
        major.Value = parts.ElementAtOrDefault(0);
        minor.Value = parts.ElementAtOrDefault(1);
        patch.Value = parts.ElementAtOrDefault(2);
        major.ValueChanged += VersionChanged;
        minor.ValueChanged += VersionChanged;
        patch.ValueChanged += VersionChanged;
        UpdatePreview();
    }

    private void VersionChanged(object? sender, EventArgs eventArgs) => UpdatePreview();
    private void UpdatePreview() => versionPreview.Text = CurrentTag();
    private string CurrentTag() => $"v{major.Value}.{minor.Value}.{patch.Value}";
    private static Version ParseVersion(string value) => Version.Parse(value.Trim().TrimStart('v', 'V'));
    private void SetInputs(bool enabled) { major.Enabled = enabled; minor.Enabled = enabled; patch.Enabled = enabled; releaseNotes.Enabled = enabled; autoPublish.Enabled = enabled; }
    private void Step(string title, string message) { status.Text = message; status.ForeColor = Muted; Log($"\n[{title.ToUpperInvariant()}] {message}\n", Accent); }
    private void Log(string message, Color color) { if (InvokeRequired) { BeginInvoke(() => Log(message, color)); return; } terminal.SelectionStart = terminal.TextLength; terminal.SelectionColor = color; terminal.AppendText(message); terminal.ScrollToCaret(); }
    private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";

    private static Panel Card() => new RoundedPanel { Dock = DockStyle.Fill, BackColor = Panel, BorderColor = Border, Radius = 14 };
    private static Button ActionButton(string text, Color background, Color foreground) => new BloomButton { Text = text, Height = 40, BackColor = background, ForeColor = foreground, Cursor = Cursors.Hand, Font = new Font("Segoe UI", 9F, FontStyle.Bold) };
    private static Button WindowButton(string text) => new BloomButton { Text = text, Size = new Size(34, 32), BackColor = Color.FromArgb(15, 18, 18), ForeColor = Muted, Font = new Font("Segoe UI", 12F), Cursor = Cursors.Hand };
    private static Control Heading(string eyebrow, string title, string description)
    {
        var panel = new Panel { Width = 310, Height = 112, BackColor = Panel };
        panel.Controls.Add(new Label { Text = description, Location = new Point(0, 57), Size = new Size(300, 45), ForeColor = Muted });
        panel.Controls.Add(new Label { Text = title, Location = new Point(0, 23), AutoSize = true, ForeColor = TextColor, Font = new Font("Segoe UI", 17F, FontStyle.Bold) });
        panel.Controls.Add(new Label { Text = eyebrow, Location = new Point(0, 0), AutoSize = true, ForeColor = Accent, Font = new Font("Segoe UI", 8F, FontStyle.Bold) });
        return panel;
    }

    private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
    {
        var diameter = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    private sealed class RoundedPanel : Panel
    {
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)] public int Radius { get; set; } = 12;
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)] public Color BorderColor { get; set; } = Border;
        public RoundedPanel() { DoubleBuffered = true; }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var path = RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), Radius);
            using var fill = new SolidBrush(BackColor);
            using var pen = new Pen(BorderColor);
            e.Graphics.FillPath(fill, path);
            e.Graphics.DrawPath(pen, path);
        }
    }

    private sealed class BloomButton : Button
    {
        private bool hovered;
        private bool pressed;
        public BloomButton()
        {
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            DoubleBuffered = true;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }
        protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hovered = pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var color = !Enabled ? Color.FromArgb(55, BackColor) : pressed ? Blend(BackColor, Color.Black, .16F) : hovered ? Blend(BackColor, Color.White, .07F) : BackColor;
            using var path = RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), 9);
            using var brush = new SolidBrush(color);
            e.Graphics.FillPath(brush, path);
            TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, Enabled ? ForeColor : Muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }

    private sealed class BloomCheckBox : CheckBox
    {
        public BloomCheckBox() { SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true); Height = 28; }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent?.BackColor ?? Panel);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var box = new Rectangle(0, 5, 18, 18);
            using var path = RoundedRectangle(box, 5);
            using var fill = new SolidBrush(Checked ? Accent : Control);
            using var pen = new Pen(Checked ? Accent : Border);
            e.Graphics.FillPath(fill, path); e.Graphics.DrawPath(pen, path);
            if (Checked) TextRenderer.DrawText(e.Graphics, "✓", new Font("Segoe UI", 8F, FontStyle.Bold), box, Color.FromArgb(12, 18, 12), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            TextRenderer.DrawText(e.Graphics, Text, Font, new Rectangle(28, 0, Width - 28, Height), Enabled ? TextColor : Muted, TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
        }
    }

    private sealed class VersionStepper : UserControl
    {
        private decimal value;
        private readonly Label number = new();
        private readonly BloomButton decrement = new() { Text = "−" };
        private readonly BloomButton increment = new() { Text = "+" };
        public event EventHandler? ValueChanged;
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)] public decimal Value { get => value; set { var next = Math.Clamp(value, 0, 999); if (this.value == next) return; this.value = next; number.Text = next.ToString(); ValueChanged?.Invoke(this, EventArgs.Empty); } }
        public VersionStepper(string caption)
        {
            Dock = DockStyle.Fill; Margin = new Padding(3); BackColor = Panel;
            Controls.Add(new Label { Text = caption, Dock = DockStyle.Top, Height = 22, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Muted, Font = new Font("Segoe UI", 7.5F, FontStyle.Bold) });
            var body = new RoundedPanel { Dock = DockStyle.Bottom, Height = 40, Radius = 8, BorderColor = Border, BackColor = Control };
            decrement.Dock = DockStyle.Left; decrement.Width = 28; decrement.BackColor = Control; decrement.ForeColor = Muted;
            increment.Dock = DockStyle.Right; increment.Width = 28; increment.BackColor = Control; increment.ForeColor = Muted;
            number.Dock = DockStyle.Fill; number.Text = "0"; number.TextAlign = ContentAlignment.MiddleCenter; number.ForeColor = TextColor; number.Font = new Font("Segoe UI Variable Text", 11F, FontStyle.Bold); number.BackColor = Control;
            decrement.Click += (_, _) => Value--; increment.Click += (_, _) => Value++;
            body.Controls.Add(number); body.Controls.Add(decrement); body.Controls.Add(increment); Controls.Add(body);
        }
        protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); decrement.Enabled = increment.Enabled = Enabled; number.ForeColor = Enabled ? TextColor : Muted; }
    }

    private static Color Blend(Color first, Color second, float amount) => Color.FromArgb(
        first.A,
        (int)(first.R + (second.R - first.R) * amount),
        (int)(first.G + (second.G - first.G) * amount),
        (int)(first.B + (second.B - first.B) * amount));

    private sealed record ProcessResult(int ExitCode, string Output, string Error);
}
