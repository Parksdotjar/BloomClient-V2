import fs from "node:fs";
import ts from "typescript";

const records = [];
const controlGroups = new Map();
const screens = {
  ClientCacheControl: "Client settings → Cache", CosmeticsSettings: "Client settings → Cosmetics",
  NewInstancePage: "Instances → New instance", InstancePage: "Open an instance",
  LogsPage: "Logs", DownloadsPage: "Downloads", InstancesPage: "Instances",
};
const files = {
  "src/main.tsx": "",
  "src/components/UtilitiesPage.tsx": "Utilities",
};
for (const [component, location] of Object.entries({
  Locker: "Locker", MinecraftWardrobe: "Locker → Skins or Capes", CosmeticsShop: "Locker → Shop",
  CapeRedemption: "Locker", ScreenshotShelf: "Screenshots", ScreenshotComparison: "Screenshots → Compare",
  SocialPlay: "Social → Party", SocialDock: "Social drawer", PlayerAccountActions: "Account menu",
  DesktopNotificationCenter: "Top bar → Notifications", DesktopIslandUpdate: "Top bar → Updates",
  StorageBreakdown: "Settings → Storage", ModMaintenance: "Settings → Updates", SocialPage: "Social", PortalPage: "Portal", AlulaHistory: "Alula → Chat history", AskDelight: "Alula",
  QuickSwitcher: "Quick switcher", InstanceFolders: "Instances", ModDetailDrawer: "Instance → Mod details",
  ContentToolbar: "Instance → Content toolbar", ContentTransfer: "Instance → Copy to instance",
  CatalogFilterControls: "Instance → Mods → Catalog filters", FabricLoaderSetting: "Instance settings",
  SidebarImageCrop: "Client settings → General → Adjust Crop", AppearancePresets: "Client settings → Appearance",
  DownloadHistory: "Downloads → Completed", ShareInstanceDialog: "Instance → Share instance",
  OnboardingFlow: "Microsoft setup", FloatingInstancePlayer: "Floating Play controls",
})) files["src/components/" + component + ".tsx"] = location;
for (const [source, defaultRoute] of Object.entries(files)) {
  const syntax = ts.createSourceFile(source, fs.readFileSync(source, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node, route) {
    if (ts.isFunctionDeclaration(node)) route = screens[node.name?.text] ?? defaultRoute;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.openingElement ?? node;
      const attributes = Object.fromEntries(tag.attributes.properties.filter(a => a.name && a.initializer && ts.isStringLiteral(a.initializer)).map(a => [a.name.text, a.initializer.text]));
      for (const prop of tag.attributes.properties) {
        if (ts.isJsxSpreadAttribute(prop) && ts.isCallExpression(prop.expression) &&
          prop.expression.expression.getText(syntax) === "section" && ts.isStringLiteral(prop.expression.arguments[0])) {
          route = "Client settings → " + prop.expression.arguments[0].text;
        }
      }
      const name = tag.tagName.getText(syntax);
      if (route && name === "button") {
        const literal = node.children?.filter(ts.isJsxText).map(n => n.text.trim()).filter(Boolean).join(" ");
        const label = attributes["aria-label"] ?? attributes.title ?? literal;
        if (label && label.length >= 4 && label.length < 80 && !/^(cancel|close|back|next|save|refresh|remove|open|delete|clear|confirm|retry|loading)$/i.test(label)) {
          const key = source + "\n" + route;
          if (!controlGroups.has(key)) controlGroups.set(key, new Set());
          controlGroups.get(key).add(label);
        }
      }
      if (name === "UtilityRule") route = "Utilities → Sync Across Instances";
      const title = name === "InfoTip" ? attributes.label : attributes.title;
      const description = name === "InfoTip" ? node.children?.filter(ts.isJsxText).map(n => n.text.trim()).join(" ") : attributes.description ?? attributes.help;
      if (route && ["SettingsRow", "SettingRow", "InfoTip", "UtilityRule"].includes(name) && title && description) {
        const id = ("ui-" + route + "-" + title).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const choices = [];
        function findChoices(child) {
          if (ts.isJsxAttribute(child) && child.name.getText(syntax) === "options" && child.initializer && ts.isJsxExpression(child.initializer) && child.initializer.expression && ts.isArrayLiteralExpression(child.initializer.expression)) {
            choices.push(...child.initializer.expression.elements.filter(ts.isStringLiteral).map(option => option.text));
          }
          ts.forEachChild(child, findChoices);
        }
        findChoices(node);
        if (!records.some(r => r.id === id)) records.push({ id, aliases: [title, ...choices].map(label => label.toLowerCase()), steps: route + " → " + title + ". " + description + (choices.length ? " Choices include " + choices.join(", ") + "." : ""), source });
      }
    }
    ts.forEachChild(node, child => visit(child, route));
  }
  visit(syntax, defaultRoute);
}
for (const [key, labels] of controlGroups) {
  const [source, route] = key.split("\n");
  const list = [...labels];
  for (let i = 0; i < list.length; i += 6) {
    const group = list.slice(i, i + 6);
    records.push({ id: "controls-" + source.split("/").pop().split(".")[0].toLowerCase() + "-" + route.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + i,
      aliases: group.map(s => s.toLowerCase()), steps: route + ". Controls available in the corresponding view or dialog include " + group.join(", ") + ".", source });
  }
}
const output = JSON.stringify({ entries: records }, null, 2) + "\n";
const path = "backend/ask-delight/ui-knowledge.json";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== output) throw Error("Alula help is stale. Run node scripts/index-alula-ui.mjs");
} else fs.writeFileSync(path, output);
console.log(records.length + " source-derived help records");
