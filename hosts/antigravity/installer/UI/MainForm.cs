using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using AntiTokenSetup.Models;
using AntiTokenSetup.Services;

namespace AntiTokenSetup.UI
{
    public sealed class MainForm : Form
    {
        private readonly ContractData _contract;
        private readonly string _initialDir;
        private bool _isChinese;
        private bool _isBusy;
        private bool _suppressProxySelectionEvent;
        private string _selectedProxyHost = "127.0.0.1";

        private DesktopInstallInfo _currentInstall;
        private List<ProxyCandidate> _proxyCandidates = new List<ProxyCandidate>();

        // Header controls
        private Label _lblTitle;
        private Label _lblSubtitle;
        private Label _lblStatusBadge;
        private Button _btnLang;

        // Path group
        private GroupBox _grpPath;
        private ComboBox _cmbPath;
        private Button _btnBrowse;
        private Button _btnRescan;
        private Label _lblInstallDetails;

        // Proxy group
        private GroupBox _grpProxy;
        private CheckBox _chkEnableProxy;
        private Label _lblDetectedProxy;
        private ComboBox _cmbProxies;
        private Label _lblProtocol;
        private RadioButton _rbSocks5;
        private RadioButton _rbHttp;
        private Label _lblPort;
        private NumericUpDown _numPort;
        private Button _btnTestProxy;
        private Label _lblProxyTestResult;

        // Actions & Log
        private Button _btnInstall;
        private Button _btnProxyOnly;
        private Button _btnUninstall;
        private CheckBox _chkLaunchAfter;
        private ProgressBar _progressBar;
        private TextBox _txtLog;

        public MainForm(ContractData contract, string initialDir = null)
        {
            _contract = contract;
            _initialDir = initialDir;
            _isChinese = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName.Equals("zh", StringComparison.OrdinalIgnoreCase);

            InitializeComponent();
            ApplyLocalization();
        }

        private void InitializeComponent()
        {
            SuspendLayout();

            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
            ClientSize = new Size(740, 580);
            MinimumSize = new Size(700, 540);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Color.FromArgb(248, 249, 251);

            var rootLayout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(16),
                ColumnCount = 1,
                RowCount = 5
            };
            rootLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // Header
            rootLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // Path
            rootLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // Proxy
            rootLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // Actions
            rootLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f)); // Progress + Log

            // 1. Header
            var headerPanel = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                ColumnCount = 3,
                Margin = new Padding(0, 0, 0, 10)
            };
            headerPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            headerPanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            headerPanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            var titleStack = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.TopDown,
                AutoSize = true,
                WrapContents = false,
                Margin = new Padding(0)
            };
            _lblTitle = new Label
            {
                AutoSize = true,
                Font = new Font(Font.FontFamily, 13.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(24, 24, 27),
                Margin = new Padding(0, 0, 0, 2)
            };
            _lblSubtitle = new Label
            {
                AutoSize = true,
                Font = new Font(Font.FontFamily, 8.75f, FontStyle.Regular),
                ForeColor = Color.FromArgb(100, 116, 139),
                Margin = new Padding(0)
            };
            titleStack.Controls.Add(_lblTitle);
            titleStack.Controls.Add(_lblSubtitle);

            _lblStatusBadge = new Label
            {
                AutoSize = true,
                Padding = new Padding(10, 5, 10, 5),
                Margin = new Padding(0, 6, 8, 0),
                Font = new Font(Font.FontFamily, 8.75f, FontStyle.Bold),
                BackColor = Color.FromArgb(226, 232, 240),
                ForeColor = Color.FromArgb(51, 65, 85),
                TextAlign = ContentAlignment.MiddleCenter
            };

            _btnLang = new Button
            {
                AutoSize = true,
                MinimumSize = new Size(64, 30),
                Margin = new Padding(0, 4, 0, 0),
                FlatStyle = FlatStyle.System
            };
            _btnLang.Click += (_, __) =>
            {
                _isChinese = !_isChinese;
                ApplyLocalization();
                RefreshInstallStatusLabels();
                RefreshProxyComboBox(preferCandidateProtocol: false);
            };

            headerPanel.Controls.Add(titleStack, 0, 0);
            headerPanel.Controls.Add(_lblStatusBadge, 1, 0);
            headerPanel.Controls.Add(_btnLang, 2, 0);

            // 2. Desktop Location Group
            _grpPath = new GroupBox
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                Padding = new Padding(12, 8, 12, 10),
                Margin = new Padding(0, 0, 0, 10)
            };

            var pathTable = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                ColumnCount = 3,
                RowCount = 2
            };
            pathTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            pathTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            pathTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            _cmbPath = new ComboBox
            {
                Dock = DockStyle.Fill,
                DropDownStyle = ComboBoxStyle.DropDown,
                Margin = new Padding(0, 3, 8, 6)
            };
            _cmbPath.SelectedIndexChanged += (_, __) => InspectCurrentPathFromUi();
            _cmbPath.Leave += (_, __) => InspectCurrentPathFromUi();

            _btnBrowse = new Button
            {
                AutoSize = true,
                MinimumSize = new Size(82, 29),
                Margin = new Padding(0, 2, 6, 6),
                FlatStyle = FlatStyle.System
            };
            _btnBrowse.Click += BtnBrowse_Click;

            _btnRescan = new Button
            {
                AutoSize = true,
                MinimumSize = new Size(88, 29),
                Margin = new Padding(0, 2, 0, 6),
                FlatStyle = FlatStyle.System
            };
            _btnRescan.Click += async (_, __) => await RunEnvironmentScanAsync();

            _lblInstallDetails = new Label
            {
                AutoSize = false,
                Dock = DockStyle.Fill,
                Height = 22,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Color.FromArgb(71, 85, 105),
                Margin = new Padding(0, 2, 0, 0)
            };

            pathTable.Controls.Add(_cmbPath, 0, 0);
            pathTable.Controls.Add(_btnBrowse, 1, 0);
            pathTable.Controls.Add(_btnRescan, 2, 0);
            pathTable.Controls.Add(_lblInstallDetails, 0, 1);
            pathTable.SetColumnSpan(_lblInstallDetails, 3);
            _grpPath.Controls.Add(pathTable);

            // 3. Proxy Group
            _grpProxy = new GroupBox
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                Padding = new Padding(12, 8, 12, 10),
                Margin = new Padding(0, 0, 0, 10)
            };

            var proxyTable = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                ColumnCount = 2,
                RowCount = 4
            };
            proxyTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            proxyTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));

            _chkEnableProxy = new CheckBox
            {
                AutoSize = true,
                Checked = true,
                Margin = new Padding(0, 2, 0, 8)
            };
            _chkEnableProxy.CheckedChanged += (_, __) => UpdateProxyInputsEnabled();
            proxyTable.Controls.Add(_chkEnableProxy, 0, 0);
            proxyTable.SetColumnSpan(_chkEnableProxy, 2);

            _lblDetectedProxy = new Label
            {
                AutoSize = true,
                Anchor = AnchorStyles.Left,
                Margin = new Padding(0, 6, 10, 6)
            };
            _cmbProxies = new ComboBox
            {
                Dock = DockStyle.Fill,
                DropDownStyle = ComboBoxStyle.DropDownList,
                Margin = new Padding(0, 3, 0, 6)
            };
            _cmbProxies.SelectedIndexChanged += CmbProxies_SelectedIndexChanged;
            proxyTable.Controls.Add(_lblDetectedProxy, 0, 1);
            proxyTable.Controls.Add(_cmbProxies, 1, 1);

            _lblProtocol = new Label
            {
                AutoSize = true,
                Anchor = AnchorStyles.Left,
                Margin = new Padding(0, 6, 10, 4)
            };

            var protoRow = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                WrapContents = false,
                Margin = new Padding(0)
            };
            _rbSocks5 = new RadioButton { Text = "SOCKS5", AutoSize = true, Checked = true, Margin = new Padding(0, 5, 14, 0) };
            _rbHttp = new RadioButton { Text = "HTTP", AutoSize = true, Margin = new Padding(0, 5, 20, 0) };
            _rbSocks5.CheckedChanged += (_, __) => { if (!_suppressProxySelectionEvent) _lblProxyTestResult.Text = ""; };
            _rbHttp.CheckedChanged += (_, __) => { if (!_suppressProxySelectionEvent) _lblProxyTestResult.Text = ""; };
            _lblPort = new Label { AutoSize = true, Margin = new Padding(0, 6, 6, 0) };
            _numPort = new NumericUpDown
            {
                Minimum = 1,
                Maximum = 65535,
                Value = 7890,
                Width = 82,
                Margin = new Padding(0, 2, 12, 0)
            };
            _numPort.ValueChanged += (_, __) => OnManualPortChanged();
            _btnTestProxy = new Button
            {
                AutoSize = true,
                MinimumSize = new Size(96, 28),
                Margin = new Padding(0, 1, 0, 0),
                FlatStyle = FlatStyle.System
            };
            _btnTestProxy.Click += BtnTestProxy_Click;

            protoRow.Controls.Add(_rbSocks5);
            protoRow.Controls.Add(_rbHttp);
            protoRow.Controls.Add(_lblPort);
            protoRow.Controls.Add(_numPort);
            protoRow.Controls.Add(_btnTestProxy);

            proxyTable.Controls.Add(_lblProtocol, 0, 2);
            proxyTable.Controls.Add(protoRow, 1, 2);

            _lblProxyTestResult = new Label
            {
                AutoSize = false,
                Dock = DockStyle.Fill,
                Height = 22,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Color.FromArgb(100, 116, 139),
                Margin = new Padding(0, 4, 0, 0)
            };
            proxyTable.Controls.Add(_lblProxyTestResult, 0, 3);
            proxyTable.SetColumnSpan(_lblProxyTestResult, 2);

            _grpProxy.Controls.Add(proxyTable);

            // 4. Actions Bar
            var actionsTable = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                ColumnCount = 1,
                RowCount = 2,
                Margin = new Padding(0, 2, 0, 8)
            };
            actionsTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));

            var btnFlow = new FlowLayoutPanel
            {
                AutoSize = true,
                WrapContents = false,
                Margin = new Padding(0)
            };
            _btnInstall = new Button
            {
                AutoSize = true,
                MinimumSize = new Size(148, 36),
                BackColor = Color.FromArgb(37, 99, 235),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font(Font.FontFamily, 9.5f, FontStyle.Bold),
                Margin = new Padding(0, 0, 8, 0),
                Cursor = Cursors.Hand
            };
            _btnInstall.FlatAppearance.BorderSize = 0;
            _btnInstall.Click += async (_, __) => await ExecuteInstallOrUpdateAsync();

            _btnProxyOnly = new Button
            {
                AutoSize = true,
                MinimumSize = new Size(112, 36),
                FlatStyle = FlatStyle.System,
                Margin = new Padding(0, 0, 8, 0)
            };
            _btnProxyOnly.Click += async (_, __) => await ExecuteProxyOnlyAsync();

            _btnUninstall = new Button
            {
                AutoSize = true,
                MinimumSize = new Size(130, 36),
                FlatStyle = FlatStyle.System,
                Margin = new Padding(0)
            };
            _btnUninstall.Click += async (_, __) => await ExecuteUninstallAsync();

            btnFlow.Controls.Add(_btnInstall);
            btnFlow.Controls.Add(_btnProxyOnly);
            btnFlow.Controls.Add(_btnUninstall);

            _chkLaunchAfter = new CheckBox
            {
                AutoSize = true,
                Checked = true,
                Anchor = AnchorStyles.Left,
                Margin = new Padding(0, 8, 0, 0)
            };

            actionsTable.Controls.Add(btnFlow, 0, 0);
            actionsTable.Controls.Add(_chkLaunchAfter, 0, 1);

            // 5. Progress + Log Area
            var logLayout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 2,
                Margin = new Padding(0)
            };
            logLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            logLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));

            _progressBar = new ProgressBar
            {
                Dock = DockStyle.Top,
                Height = 8,
                Style = ProgressBarStyle.Continuous,
                Margin = new Padding(0, 0, 0, 8)
            };

            _txtLog = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BackColor = Color.White,
                ForeColor = Color.FromArgb(30, 41, 59),
                Font = new Font("Consolas", 9f),
                BorderStyle = BorderStyle.FixedSingle
            };

            logLayout.Controls.Add(_progressBar, 0, 0);
            logLayout.Controls.Add(_txtLog, 0, 1);

            rootLayout.Controls.Add(headerPanel, 0, 0);
            rootLayout.Controls.Add(_grpPath, 0, 1);
            rootLayout.Controls.Add(_grpProxy, 0, 2);
            rootLayout.Controls.Add(actionsTable, 0, 3);
            rootLayout.Controls.Add(logLayout, 0, 4);

            Controls.Add(rootLayout);
            ResumeLayout(false);
            PerformLayout();

            Shown += async (_, __) => await RunEnvironmentScanAsync();
        }

        private string T(string zh, string en) => _isChinese ? zh : en;

        private void ApplyLocalization()
        {
            Text = T(
                $"Antigravity Token Stats 安装向导 v{_contract.Version}",
                $"Antigravity Token Stats Setup v{_contract.Version}");
            _lblTitle.Text = "Antigravity Token Stats";
            _lblSubtitle.Text = T(
                $"桌面端零依赖安装器 · v{_contract.Version}",
                $"Desktop Standalone Installer · v{_contract.Version}");
            _btnLang.Text = _isChinese ? "EN" : "中文";

            _grpPath.Text = T("Antigravity 桌面端安装位置", "Antigravity Desktop Location");
            _btnBrowse.Text = T("浏览...", "Browse...");
            _btnRescan.Text = T("重新扫描", "Rescan");

            _grpProxy.Text = T("免 TUN 透明代理配置（可选）", "Transparent Proxy Configuration (Optional)");
            _chkEnableProxy.Text = T(
                "配置免 TUN 透明代理（推荐，解决地区限制与接口直连）",
                "Enable transparent proxy (recommended for region/API connectivity)");
            _lblDetectedProxy.Text = T("本机代理:", "Local Proxy:");
            _lblProtocol.Text = T("协议与端口:", "Protocol / Port:");
            _lblPort.Text = T("端口:", "Port:");
            _btnTestProxy.Text = T("测试连通性", "Test Proxy");

            _btnInstall.Text = T("安装 / 更新补丁", "Install / Update Patch");
            _btnProxyOnly.Text = T("仅更新代理", "Update Proxy Only");
            _btnUninstall.Text = T("卸载 / 还原出厂", "Uninstall / Restore Factory");
            _chkLaunchAfter.Text = T("完成后启动 Antigravity", "Launch when done");
        }

        private void AppendLog(string message)
        {
            if (IsDisposed || Disposing) return;
            if (InvokeRequired)
            {
                if (!IsHandleCreated) return;
                try
                {
                    BeginInvoke(new Action<string>(AppendLog), message);
                }
                catch (ObjectDisposedException) { }
                return;
            }
            string ts = DateTime.Now.ToString("HH:mm:ss");
            _txtLog.AppendText($"[{ts}] {message}{Environment.NewLine}");
        }

        private void SetBusy(bool busy)
        {
            if (IsDisposed || Disposing) return;
            _isBusy = busy;
            _progressBar.Style = busy ? ProgressBarStyle.Marquee : ProgressBarStyle.Continuous;
            _progressBar.Value = 0;

            _cmbPath.Enabled = !busy;
            _btnBrowse.Enabled = !busy;
            _btnRescan.Enabled = !busy;
            _chkEnableProxy.Enabled = !busy;
            _btnInstall.Enabled = !busy;
            _btnProxyOnly.Enabled = !busy;
            _btnUninstall.Enabled = !busy;
            UpdateProxyInputsEnabled();
        }

        private void UpdateProxyInputsEnabled()
        {
            bool enabled = !_isBusy && _chkEnableProxy.Checked;
            _cmbProxies.Enabled = enabled;
            _rbSocks5.Enabled = enabled;
            _rbHttp.Enabled = enabled;
            _numPort.Enabled = enabled;
            _btnTestProxy.Enabled = enabled;
        }

        private async Task RunEnvironmentScanAsync()
        {
            if (_isBusy) return;
            SetBusy(true);
            try
            {
                AppendLog(T("正在扫描 Antigravity 桌面端与本机代理端口...", "Scanning Antigravity Desktop and local proxy ports..."));
                string preferred = !string.IsNullOrWhiteSpace(_cmbPath.Text) ? _cmbPath.Text : _initialDir;

                var installs = await Task.Run(() => EnvironmentDetector.DetectDesktopInstallations(_contract, preferred));
                if (IsDisposed || Disposing) return;

                _cmbPath.Items.Clear();
                foreach (var item in installs)
                {
                    _cmbPath.Items.Add(item.RootDir);
                }

                if (installs.Count > 0)
                {
                    _currentInstall = installs[0];
                    _cmbPath.Text = _currentInstall.RootDir;
                    AppendLog(T(
                        $"已定位桌面端: {_currentInstall.RootDir} ({_currentInstall.Source})",
                        $"Found Desktop: {_currentInstall.RootDir} ({_currentInstall.Source})"));
                }
                else
                {
                    _currentInstall = null;
                    if (!string.IsNullOrWhiteSpace(preferred))
                    {
                        _cmbPath.Text = preferred;
                    }
                    AppendLog(T(
                        "未自动检测到 Antigravity 桌面端，请点击「浏览...」手动选择安装目录。",
                        "Antigravity Desktop not auto-detected. Use Browse... to locate it."));
                }

                RefreshInstallStatusLabels();

                int existingPort = _currentInstall?.ExistingProxyPort ?? 0;
                _proxyCandidates = await EnvironmentDetector.DetectLocalProxiesAsync(existingPort);
                if (IsDisposed || Disposing) return;

                if (_currentInstall != null && _currentInstall.ProxyInstalled && _currentInstall.ExistingProxyPort > 0)
                {
                    _suppressProxySelectionEvent = true;
                    try
                    {
                        _chkEnableProxy.Checked = true;
                        _numPort.Value = Math.Min(65535, Math.Max(1, _currentInstall.ExistingProxyPort));
                        _selectedProxyHost = string.IsNullOrWhiteSpace(_currentInstall.ExistingProxyHost)
                            ? "127.0.0.1"
                            : _currentInstall.ExistingProxyHost.Trim();
                        if (string.Equals(_currentInstall.ExistingProxyType, "http", StringComparison.OrdinalIgnoreCase))
                        {
                            _rbHttp.Checked = true;
                        }
                        else
                        {
                            _rbSocks5.Checked = true;
                        }
                    }
                    finally
                    {
                        _suppressProxySelectionEvent = false;
                    }
                    RefreshProxyComboBox(preferCandidateProtocol: false);
                }
                else
                {
                    RefreshProxyComboBox(preferCandidateProtocol: true);
                }

                if (_proxyCandidates.Count > 0)
                {
                    AppendLog(T(
                        $"探测到 {_proxyCandidates.Count} 个可用本地代理: {string.Join(", ", _proxyCandidates.Select(p => $"{p.Port}({p.ProtocolLabel})"))}",
                        $"Detected {_proxyCandidates.Count} local proxy candidate(s): {string.Join(", ", _proxyCandidates.Select(p => $"{p.Port}({p.ProtocolLabel})"))}"));
                }
                else
                {
                    AppendLog(T(
                        "未探测到运行中的本地代理端口；如需使用代理请手动填写端口，或取消勾选代理选项。",
                        "No active local proxy detected; enter port manually or uncheck proxy option."));
                }
            }
            catch (Exception ex)
            {
                AppendLog(T($"扫描异常: {ex.Message}", $"Scan error: {ex.Message}"));
            }
            finally
            {
                SetBusy(false);
            }
        }

        private void InspectCurrentPathFromUi()
        {
            string pathText = _cmbPath.Text?.Trim();
            if (string.IsNullOrEmpty(pathText))
            {
                _currentInstall = null;
            }
            else
            {
                try
                {
                    _currentInstall = EnvironmentDetector.InspectDesktopDirectory(pathText, "Selected", _contract);
                }
                catch
                {
                    _currentInstall = null;
                }
            }
            RefreshInstallStatusLabels();
        }

        private void RefreshInstallStatusLabels()
        {
            if (_currentInstall == null || !_currentInstall.HasAsar)
            {
                _lblStatusBadge.Text = T("未检测到客户端", "Not Found");
                _lblStatusBadge.BackColor = Color.FromArgb(254, 226, 226);
                _lblStatusBadge.ForeColor = Color.FromArgb(153, 27, 27);
                _lblInstallDetails.Text = T(
                    "请选择包含 Antigravity.exe 与 resources\\app.asar 的安装目录。",
                    "Select the Antigravity folder containing Antigravity.exe and resources\\app.asar.");
                return;
            }

            string patchState = _currentInstall.IsPatched
                ? T("已注入看板", "Patched")
                : T("未打补丁", "Unpatched");
            string runState = _currentInstall.IsRunning
                ? T(" · 运行中", " · Running")
                : "";

            _lblStatusBadge.Text = patchState + runState;
            if (_currentInstall.IsPatched)
            {
                _lblStatusBadge.BackColor = Color.FromArgb(220, 252, 231);
                _lblStatusBadge.ForeColor = Color.FromArgb(22, 101, 52);
            }
            else
            {
                _lblStatusBadge.BackColor = Color.FromArgb(254, 243, 199);
                _lblStatusBadge.ForeColor = Color.FromArgb(146, 64, 14);
            }

            string backupText = _currentInstall.HasBackup ? T("有原厂备份", "Backup OK") : T("无备份", "No Backup");
            string existingHost = string.IsNullOrWhiteSpace(_currentInstall.ExistingProxyHost) ? "127.0.0.1" : _currentInstall.ExistingProxyHost;
            string proxyText = _currentInstall.ProxyInstalled
                ? T(
                    $"已配置 ({_currentInstall.ExistingProxyType}://{existingHost}:{_currentInstall.ExistingProxyPort})",
                    $"Configured ({_currentInstall.ExistingProxyType}://{existingHost}:{_currentInstall.ExistingProxyPort})")
                : T("未配置", "Not Configured");
            string permText = _currentInstall.NeedsElevation ? T(" · 需要管理员权限", " · Needs Admin") : "";

            _lblInstallDetails.Text = T(
                $"app.asar: 正常 | 补丁状态: {patchState} ({backupText}) | 透明代理: {proxyText}{permText}",
                $"app.asar: Found | Patch: {patchState} ({backupText}) | Proxy: {proxyText}{permText}");
        }

        private void RefreshProxyComboBox(bool preferCandidateProtocol = true)
        {
            _suppressProxySelectionEvent = true;
            try
            {
                int prevSelectedPort = (int)_numPort.Value;
                _cmbProxies.Items.Clear();

                foreach (var candidate in _proxyCandidates)
                {
                    _cmbProxies.Items.Add(candidate.DisplayText);
                }
                _cmbProxies.Items.Add(T("手动指定端口...", "Manual port..."));

                if (_proxyCandidates.Count > 0)
                {
                    int matchIdx = _proxyCandidates.FindIndex(c => c.Port == prevSelectedPort);
                    if (matchIdx >= 0)
                    {
                        _cmbProxies.SelectedIndex = matchIdx;
                        var chosen = _proxyCandidates[matchIdx];
                        _selectedProxyHost = string.IsNullOrWhiteSpace(chosen.Host) ? "127.0.0.1" : chosen.Host;
                        if (preferCandidateProtocol)
                        {
                            if (chosen.SupportsSocks5) _rbSocks5.Checked = true;
                            else if (chosen.SupportsHttp) _rbHttp.Checked = true;
                        }
                    }
                    else if (!preferCandidateProtocol)
                    {
                        _cmbProxies.SelectedIndex = _cmbProxies.Items.Count - 1;
                    }
                    else
                    {
                        _cmbProxies.SelectedIndex = 0;
                        var chosen = _proxyCandidates[0];
                        _numPort.Value = Math.Min(65535, Math.Max(1, chosen.Port));
                        _selectedProxyHost = string.IsNullOrWhiteSpace(chosen.Host) ? "127.0.0.1" : chosen.Host;
                        if (chosen.SupportsSocks5) _rbSocks5.Checked = true;
                        else if (chosen.SupportsHttp) _rbHttp.Checked = true;
                    }
                }
                else
                {
                    _cmbProxies.SelectedIndex = _cmbProxies.Items.Count - 1;
                    if (preferCandidateProtocol)
                    {
                        _selectedProxyHost = "127.0.0.1";
                    }
                }
            }
            finally
            {
                _suppressProxySelectionEvent = false;
            }
        }

        private void OnManualPortChanged()
        {
            if (_suppressProxySelectionEvent) return;
            _suppressProxySelectionEvent = true;
            try
            {
                int port = (int)_numPort.Value;
                int matchIdx = _proxyCandidates.FindIndex(c => c.Port == port);
                if (matchIdx >= 0)
                {
                    _cmbProxies.SelectedIndex = matchIdx;
                    var chosen = _proxyCandidates[matchIdx];
                    _selectedProxyHost = string.IsNullOrWhiteSpace(chosen.Host) ? "127.0.0.1" : chosen.Host;
                }
                else if (_cmbProxies.Items.Count > 0)
                {
                    _cmbProxies.SelectedIndex = _cmbProxies.Items.Count - 1;
                    _selectedProxyHost = "127.0.0.1";
                }
                _lblProxyTestResult.Text = "";
            }
            finally
            {
                _suppressProxySelectionEvent = false;
            }
        }

        private void CmbProxies_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (_suppressProxySelectionEvent) return;
            _suppressProxySelectionEvent = true;
            try
            {
                int idx = _cmbProxies.SelectedIndex;
                if (idx >= 0 && idx < _proxyCandidates.Count)
                {
                    var c = _proxyCandidates[idx];
                    _numPort.Value = Math.Min(65535, Math.Max(1, c.Port));
                    _selectedProxyHost = string.IsNullOrWhiteSpace(c.Host) ? "127.0.0.1" : c.Host;
                    if (c.SupportsSocks5) _rbSocks5.Checked = true;
                    else if (c.SupportsHttp) _rbHttp.Checked = true;
                }
                else
                {
                    _selectedProxyHost = "127.0.0.1";
                }
                _lblProxyTestResult.Text = "";
            }
            finally
            {
                _suppressProxySelectionEvent = false;
            }
        }

        private void BtnBrowse_Click(object sender, EventArgs e)
        {
            using (var dlg = new FolderBrowserDialog())
            {
                dlg.Description = T(
                    "选择 Antigravity 桌面端安装目录（包含 Antigravity.exe）",
                    "Select Antigravity Desktop installation folder (containing Antigravity.exe)");
                if (!string.IsNullOrWhiteSpace(_cmbPath.Text) && Directory.Exists(_cmbPath.Text))
                {
                    dlg.SelectedPath = _cmbPath.Text;
                }
                if (dlg.ShowDialog(this) == DialogResult.OK)
                {
                    _cmbPath.Text = dlg.SelectedPath;
                    InspectCurrentPathFromUi();
                }
            }
        }

        private async void BtnTestProxy_Click(object sender, EventArgs e)
        {
            if (_isBusy) return;
            string host = string.IsNullOrWhiteSpace(_selectedProxyHost) ? "127.0.0.1" : _selectedProxyHost;
            int port = (int)_numPort.Value;
            string type = _rbHttp.Checked ? "http" : "socks5";
            _btnTestProxy.Enabled = false;
            _lblProxyTestResult.ForeColor = Color.FromArgb(100, 116, 139);
            _lblProxyTestResult.Text = T($"正在测试 {type.ToUpperInvariant()}://{host}:{port} -> Google API...", $"Testing {type.ToUpperInvariant()}://{host}:{port} -> Google API...");

            try
            {
                var result = await EnvironmentDetector.TestProxyAsync(host, port, type);
                if (IsDisposed || Disposing) return;

                if (result.Ok)
                {
                    _lblProxyTestResult.ForeColor = Color.FromArgb(22, 163, 74);
                    _lblProxyTestResult.Text = T(
                        $"✓ 连通正常（握手+隧道 {result.TotalLatencyMs} ms）",
                        $"✓ Connected ({result.TotalLatencyMs} ms)");
                    AppendLog($"[Proxy Test] {result.Message}");
                }
                else
                {
                    _lblProxyTestResult.ForeColor = Color.FromArgb(220, 38, 38);
                    _lblProxyTestResult.Text = T($"✕ 测试失败: {result.Message}", $"✕ Failed: {result.Message}");
                    AppendLog($"[Proxy Test] FAILED: {result.Message}");
                }
            }
            catch (Exception ex)
            {
                if (!IsDisposed && !Disposing)
                {
                    _lblProxyTestResult.ForeColor = Color.FromArgb(220, 38, 38);
                    _lblProxyTestResult.Text = T($"✕ 测试失败: {ex.Message}", $"✕ Failed: {ex.Message}");
                    AppendLog($"[Proxy Test] ERROR: {ex.Message}");
                }
            }
            finally
            {
                if (!IsDisposed && !Disposing)
                {
                    _btnTestProxy.Enabled = !_isBusy && _chkEnableProxy.Checked;
                }
            }
        }

        private bool EnsurePreconditions(bool requireAsar, bool requireStopProcess, bool requireExeOrAsar = false)
        {
            InspectCurrentPathFromUi();
            if (_currentInstall == null || !_currentInstall.Exists)
            {
                MessageBox.Show(this,
                    T("请先选择有效的 Antigravity 安装目录。", "Please select a valid Antigravity installation folder."),
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (requireAsar && !_currentInstall.HasAsar)
            {
                MessageBox.Show(this,
                    T($"未在所选目录找到 resources\\app.asar：\n{_currentInstall.AsarPath}", $"resources\\app.asar not found at:\n{_currentInstall.AsarPath}"),
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (requireExeOrAsar && !File.Exists(_currentInstall.ExePath) && !_currentInstall.HasAsar)
            {
                MessageBox.Show(this,
                    T($"所选目录未找到 Antigravity.exe 或 resources\\app.asar：\n{_currentInstall.RootDir}", $"Neither Antigravity.exe nor resources\\app.asar was found in:\n{_currentInstall.RootDir}"),
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }

            if (_currentInstall.NeedsElevation && !EnvironmentDetector.IsAdministrator())
            {
                var res = MessageBox.Show(this,
                    T("目标安装目录位于受保护位置（如 Program Files），需要管理员权限。\n是否以管理员身份重新启动安装器？",
                      "The target folder requires Administrator privileges.\nRelaunch installer as Administrator?"),
                    Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (res == DialogResult.Yes)
                {
                    try
                    {
                        EnvironmentDetector.RelaunchElevated(_currentInstall.RootDir);
                        Close();
                    }
                    catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
                    {
                        AppendLog(T("已取消管理员提权。", "Administrator elevation cancelled."));
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show(this, ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }
                return false;
            }

            if (requireStopProcess && EnvironmentDetector.IsAntigravityRunning())
            {
                var res = MessageBox.Show(this,
                    T("检测到 Antigravity.exe 正在运行。\n是否自动关闭 Antigravity 以安全完成文件替换？",
                      "Antigravity.exe is currently running.\nClose it automatically to continue safely?"),
                    Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (res != DialogResult.Yes)
                {
                    AppendLog(T("操作已取消：请先关闭 Antigravity。", "Cancelled: please close Antigravity first."));
                    return false;
                }
                AppendLog(T("正在关闭运行中的 Antigravity.exe...", "Closing running Antigravity.exe..."));
                if (!EnvironmentDetector.StopAntigravityProcesses(5000))
                {
                    MessageBox.Show(this,
                        T("未能关闭 Antigravity.exe，请手动退出后重试。", "Could not close Antigravity.exe. Please exit it manually and retry."),
                        Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return false;
                }
                AppendLog(T("   ✓ Antigravity.exe 已退出。", "   ✓ Antigravity.exe closed."));
            }

            return true;
        }

        private async Task ExecuteInstallOrUpdateAsync()
        {
            if (_isBusy) return;
            if (!EnsurePreconditions(requireAsar: true, requireStopProcess: true)) return;

            string rootDir = _currentInstall.RootDir;
            string resourcesDir = _currentInstall.ResourcesDir;
            bool enableProxy = _chkEnableProxy.Checked;
            string proxyHost = string.IsNullOrWhiteSpace(_selectedProxyHost) ? "127.0.0.1" : _selectedProxyHost;
            int proxyPort = (int)_numPort.Value;
            string proxyType = _rbHttp.Checked ? "http" : "socks5";

            SetBusy(true);
            try
            {
                AppendLog(T("开始安装 / 更新 Antigravity Token Stats 补丁...", "Starting patch installation..."));
                var result = await Task.Run(() =>
                {
                    var patchRes = AsarPatcher.Patch(resourcesDir, _contract, log: AppendLog);
                    if (enableProxy)
                    {
                        ProxyInstaller.Install(rootDir, proxyHost, proxyPort, proxyType, AppendLog);
                    }
                    return patchRes;
                });
                if (IsDisposed || Disposing) return;

                InspectCurrentPathFromUi();
                AppendLog(T(
                    "✓ 安装完成！请在 Antigravity 中点击 Settings -> Usage Stats。",
                    "✓ Installation complete! Open Settings -> Usage Stats inside Antigravity."));

                if (_chkLaunchAfter.Checked && File.Exists(_currentInstall.ExePath))
                {
                    LaunchAntigravity(_currentInstall.ExePath, _currentInstall.RootDir);
                }

                MessageBox.Show(this,
                    T("安装成功！\n打开 Antigravity 后进入 Settings -> Usage Stats 即可查看统计看板。",
                      "Installation succeeded!\nOpen Settings -> Usage Stats in Antigravity to view the dashboard."),
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                AppendLog(T($"✕ 安装失败: {ex.Message}", $"✕ Installation failed: {ex.Message}"));
                MessageBox.Show(this, ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                SetBusy(false);
                InspectCurrentPathFromUi();
            }
        }

        private async Task ExecuteProxyOnlyAsync()
        {
            if (_isBusy) return;
            if (!EnsurePreconditions(requireAsar: false, requireStopProcess: false, requireExeOrAsar: true)) return;

            string rootDir = _currentInstall.RootDir;
            string proxyHost = string.IsNullOrWhiteSpace(_selectedProxyHost) ? "127.0.0.1" : _selectedProxyHost;
            int proxyPort = (int)_numPort.Value;
            string proxyType = _rbHttp.Checked ? "http" : "socks5";

            // Only require closing Antigravity if version.dll needs writing/updating while running
            string targetDll = Path.Combine(rootDir, "version.dll");
            bool dllMatches = false;
            if (File.Exists(targetDll))
            {
                try
                {
                    string embeddedHash = EmbeddedAssets.ComputeSha256Hex(EmbeddedAssets.ReadBytes("version.dll"));
                    dllMatches = string.Equals(EmbeddedAssets.ComputeFileSha256Hex(targetDll), embeddedHash, StringComparison.Ordinal);
                }
                catch { }
            }

            if (!dllMatches && EnvironmentDetector.IsAntigravityRunning())
            {
                if (!EnsurePreconditions(requireAsar: false, requireStopProcess: true, requireExeOrAsar: true)) return;
            }

            SetBusy(true);
            try
            {
                AppendLog(T("正在更新透明代理配置...", "Updating transparent proxy..."));
                await Task.Run(() => ProxyInstaller.Install(rootDir, proxyHost, proxyPort, proxyType, AppendLog));
                if (IsDisposed || Disposing) return;
                InspectCurrentPathFromUi();
                AppendLog(T("✓ 透明代理更新完成。", "✓ Transparent proxy updated."));

                if (_chkLaunchAfter.Checked && !EnvironmentDetector.IsAntigravityRunning() && File.Exists(_currentInstall.ExePath))
                {
                    LaunchAntigravity(_currentInstall.ExePath, _currentInstall.RootDir);
                }

                MessageBox.Show(this,
                    T($"透明代理已配置为 {proxyType}://{proxyHost}:{proxyPort}。",
                      $"Transparent proxy configured as {proxyType}://{proxyHost}:{proxyPort}."),
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                AppendLog(T($"✕ 代理更新失败: {ex.Message}", $"✕ Proxy update failed: {ex.Message}"));
                MessageBox.Show(this, ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                SetBusy(false);
                InspectCurrentPathFromUi();
            }
        }

        private async Task ExecuteUninstallAsync()
        {
            if (_isBusy) return;
            if (!EnsurePreconditions(requireAsar: true, requireStopProcess: true)) return;

            var confirm = MessageBox.Show(this,
                T("确定要卸载补丁并还原 Antigravity 官方出厂状态吗？（将同时移除透明代理文件）",
                  "Are you sure you want to uninstall and restore Antigravity to factory state? (Transparent proxy files will also be removed)"),
                Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes) return;

            string resourcesDir = _currentInstall.ResourcesDir;
            SetBusy(true);
            try
            {
                AppendLog(T("正在卸载并还原出厂状态...", "Uninstalling and restoring factory state..."));
                var result = await Task.Run(() => AsarPatcher.Unpatch(resourcesDir, _contract, removeProxy: true, log: AppendLog));
                if (IsDisposed || Disposing) return;
                InspectCurrentPathFromUi();

                if (result.Pristine)
                {
                    AppendLog(T("✓ 已卸载补丁并还原至官方初始状态。", "✓ Successfully uninstalled and factory state restored."));
                    MessageBox.Show(this,
                        T("已成功卸载并还原至官方出厂状态。", "Successfully uninstalled and restored to factory state."),
                        Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                else
                {
                    AppendLog($"⚠️ {result.Message}");
                    MessageBox.Show(this,
                        T("未找到 app.asar.backup，无法从备份还原 app.asar；已清理代理与重定向文件。",
                          "app.asar.backup was not found; proxy and redirect files were cleaned."),
                        Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            catch (Exception ex)
            {
                AppendLog(T($"✕ 卸载还原失败: {ex.Message}", $"✕ Uninstall and restore failed: {ex.Message}"));
                MessageBox.Show(this, ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                SetBusy(false);
                InspectCurrentPathFromUi();
            }
        }

        private void LaunchAntigravity(string exePath, string workDir)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = exePath,
                    WorkingDirectory = workDir,
                    UseShellExecute = true
                });
                AppendLog(T("已启动 Antigravity.exe。", "Launched Antigravity.exe."));
            }
            catch (Exception ex)
            {
                AppendLog(T($"启动 Antigravity 失败: {ex.Message}", $"Failed to launch Antigravity: {ex.Message}"));
            }
        }
    }
}
