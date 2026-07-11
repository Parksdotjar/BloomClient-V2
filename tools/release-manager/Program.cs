using System.Diagnostics;
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
    private static readonly Color Background = Color.FromArgb(8, 10, 10);
    private static readonly Color Panel = Color.FromArgb(14, 17, 17);
    private static readonly Color Control = Color.FromArgb(21, 25, 25);
    private static readonly Color Border = Color.FromArgb(43, 49, 49);
    private static readonly Color TextColor = Color.FromArgb(239, 244, 242);
    private static readonly Color Muted = Color.FromArgb(130, 143, 139);
    private static readonly Color Accent = Color.FromArgb(142, 227, 101);
    private readonly string repo;
    private readonly NumericUpDown major = VersionNumber();
    private readonly NumericUpDown minor = VersionNumber();
    private readonly NumericUpDown patch = VersionNumber();
    private readonly Label versionPreview = new();
    private readonly TextBox releaseNotes = new();
    private readonly RichTextBox terminal = new();
    private readonly Button publish = new();
    private readonly CheckBox autoPublish = new();
    private readonly Label status = new();
    private bool running;

    public ReleaseManagerForm(string repoPath)
    {
        repo = repoPath;
        Text = "Bloom Release Manager";
        ClientSize = new Size(1040, 720);
        MinimumSize = new Size(900, 640);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Background;
        ForeColor = TextColor;
        Font = new Font("Segoe UI", 9F);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2, Padding = new Padding(24), BackColor = Background };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 365));
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
        Controls.Add(root);

        root.Controls.Add(BuildControls(), 0, 0);
        root.Controls.Add(BuildTerminal(), 1, 0);
        root.SetColumnSpan(BuildFooter(root), 2);
        LoadVersion();
    }

    private Control BuildControls()
    {
        var card = Card();
        card.Padding = new Padding(22);
        var layout = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, BackColor = Panel };
        card.Controls.Add(layout);
        layout.Controls.Add(Heading("OWNER TOOL", "Release Bloom Client", "Choose the next version and let the manager handle the complete signed GitHub release."));

        versionPreview.AutoSize = false;
        versionPreview.Size = new Size(305, 58);
        versionPreview.TextAlign = ContentAlignment.MiddleCenter;
        versionPreview.Font = new Font("Segoe UI", 21F, FontStyle.Bold);
        versionPreview.ForeColor = Accent;
        versionPreview.BackColor = Control;
        layout.Controls.Add(versionPreview);

        var versionGrid = new TableLayoutPanel { Width = 305, Height = 82, ColumnCount = 3, RowCount = 1, Margin = new Padding(0, 12, 0, 0), BackColor = Panel };
        for (var i = 0; i < 3; i++) versionGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33F));
        versionGrid.Controls.Add(VersionPicker("MAJOR", major), 0, 0);
        versionGrid.Controls.Add(VersionPicker("MINOR", minor), 1, 0);
        versionGrid.Controls.Add(VersionPicker("PATCH", patch), 2, 0);
        layout.Controls.Add(versionGrid);

        var patchButton = ActionButton("+ Next patch", Accent, Color.FromArgb(14, 20, 13));
        patchButton.Width = 305;
        patchButton.Margin = new Padding(0, 10, 0, 0);
        patchButton.Click += (_, _) => patch.Value++;
        layout.Controls.Add(patchButton);

        var notesLabel = new Label { Text = "RELEASE NOTES", AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI", 8F, FontStyle.Bold), Margin = new Padding(0, 20, 0, 7) };
        layout.Controls.Add(notesLabel);
        releaseNotes.Multiline = true;
        releaseNotes.Width = 305;
        releaseNotes.Height = 135;
        releaseNotes.BackColor = Control;
        releaseNotes.ForeColor = TextColor;
        releaseNotes.BorderStyle = BorderStyle.FixedSingle;
        releaseNotes.PlaceholderText = "What changed in this release?";
        layout.Controls.Add(releaseNotes);

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
        var title = new Label { Text = "LIVE RELEASE OUTPUT", Dock = DockStyle.Top, Height = 28, ForeColor = Muted, Font = new Font("Segoe UI", 8F, FontStyle.Bold) };
        terminal.Dock = DockStyle.Fill;
        terminal.ReadOnly = true;
        terminal.BorderStyle = BorderStyle.None;
        terminal.BackColor = Color.FromArgb(6, 8, 8);
        terminal.ForeColor = Color.FromArgb(183, 197, 192);
        terminal.Font = new Font("Cascadia Mono", 9F);
        terminal.DetectUrls = false;
        terminal.Text = "Bloom Release Manager ready.\nNo command windows will be opened.\n\n";
        card.Controls.Add(terminal);
        card.Controls.Add(title);
        return card;
    }

    private Control BuildFooter(TableLayoutPanel root)
    {
        var footer = new Panel { Dock = DockStyle.Fill, Margin = new Padding(0, 14, 0, 0), BackColor = Background };
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
        publish.Width = 210;
        publish.Height = 40;
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
        try
        {
            Step("Preflight", "Checking repository and GitHub access");
            await MustRun("gh", "auth status");
            await MustRun("git", "fetch origin main --tags");
            var branch = (await CaptureOutput("git", "branch --show-current")).Trim();
            if (branch != "main") throw new InvalidOperationException("The repository must be on the main branch.");
            var dirty = await CaptureOutput("git", "status --porcelain --untracked-files=all");
            if (!string.IsNullOrWhiteSpace(dirty)) throw new InvalidOperationException("Commit or discard the current repository changes before publishing a release.");
            var divergence = (await CaptureOutput("git", "rev-list --left-right --count origin/main...HEAD")).Trim();
            if (divergence != "0\t0" && divergence != "0 0") throw new InvalidOperationException("Local main and origin/main must match before releasing.");
            if (!string.IsNullOrWhiteSpace(await CaptureOutput("git", $"tag -l {Quote(tag)}"))) throw new InvalidOperationException($"Tag {tag} already exists.");

            Step("Version", $"Synchronizing Bloom Client to {tag}");
            await File.WriteAllTextAsync(Path.Combine(repo, "VERSION"), tag + Environment.NewLine);
            await MustRun("npm.cmd", "run version:sync");

            Step("Checks", "Running frontend and native validation");
            await MustRun("npm.cmd", "run typecheck");
            await MustRun("npm.cmd", "run build");
            await MustRun("cargo", "test --manifest-path src-tauri/Cargo.toml");

            Step("Git", "Committing and pushing the release version");
            await MustRun("git", "add VERSION package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json");
            await MustRun("git", $"commit -m {Quote($"Release {tag}")}");
            await MustRun("git", "push origin main");
            await MustRun("git", $"tag -a {Quote(tag)} -m {Quote($"Bloom Client {tag}")}");
            await MustRun("git", $"push origin {Quote(tag)}");

            Step("GitHub", "Waiting for the signed Windows build to start");
            var runId = await FindReleaseRun(tag);
            if (runId == 0) throw new InvalidOperationException("The GitHub release workflow did not start within two minutes.");
            await MustRun("gh", $"run watch {runId} --exit-status");

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
        var info = new ProcessStartInfo(file, arguments)
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

    private static NumericUpDown VersionNumber() => new() { Minimum = 0, Maximum = 999, Width = 82, Height = 30, TextAlign = HorizontalAlignment.Center, BackColor = Control, ForeColor = TextColor, BorderStyle = BorderStyle.FixedSingle, Font = new Font("Segoe UI", 11F, FontStyle.Bold) };
    private static Panel Card() => new() { Dock = DockStyle.Fill, BackColor = Panel, BorderStyle = BorderStyle.FixedSingle };
    private static Button ActionButton(string text, Color background, Color foreground) => new() { Text = text, Height = 38, FlatStyle = FlatStyle.Flat, BackColor = background, ForeColor = foreground, Cursor = Cursors.Hand, Font = new Font("Segoe UI", 9F, FontStyle.Bold) };
    private static Control Heading(string eyebrow, string title, string description)
    {
        var panel = new Panel { Width = 305, Height = 112, BackColor = Panel };
        panel.Controls.Add(new Label { Text = description, Location = new Point(0, 57), Size = new Size(300, 45), ForeColor = Muted });
        panel.Controls.Add(new Label { Text = title, Location = new Point(0, 23), AutoSize = true, ForeColor = TextColor, Font = new Font("Segoe UI", 17F, FontStyle.Bold) });
        panel.Controls.Add(new Label { Text = eyebrow, Location = new Point(0, 0), AutoSize = true, ForeColor = Accent, Font = new Font("Segoe UI", 8F, FontStyle.Bold) });
        return panel;
    }
    private static Control VersionPicker(string label, NumericUpDown input)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Panel };
        var caption = new Label { Text = label, Dock = DockStyle.Top, Height = 22, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Muted, Font = new Font("Segoe UI", 7.5F, FontStyle.Bold) };
        input.Location = new Point(9, 28);
        panel.Controls.Add(input);
        panel.Controls.Add(caption);
        return panel;
    }

    private sealed record ProcessResult(int ExitCode, string Output, string Error);
}
