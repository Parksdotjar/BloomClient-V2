# Bloom Client Changelog Rules

Use this guide whenever preparing release notes for Bloom Client. Changelogs should be ready to paste directly into the Bloom Discord server.

## Required format

1. Start with the Bloom header and exact release version.
2. Group changes by what users experience, not by source file or programming language.
3. Lead with the largest new feature or most important improvement.
4. Describe the result of technical work in plain language, while retaining useful details such as 2D rendering, Modrinth support, or folder behavior.
5. Include every meaningful user-facing change, but combine closely related fixes instead of repeating them.
6. Never claim that a feature works unless it is implemented in that release.
7. Never include secrets, private backend addresses, credentials, internal network details, or unpublished infrastructure information.
8. Keep each bullet focused on one change and begin it with a past-tense action such as **Added**, **Fixed**, **Improved**, **Replaced**, or **Reduced**.
9. End with one short italicized sentence explaining the release's overall focus.

## Discord styling

- Main header: `# :BloomPetals: **Bloom Client — Patch Notes** :BloomPetals:`
- Version: `## **Version x.y.z**`
- Categories: `### **Category**`
- Use `**bold**` only for important features, controls, and page names.
- Use `*italics*` for the final summary sentence.
- Prefer clean bullets over long paragraphs.
- Do not add code blocks around the changelog.

## Recommended categories

Only include categories that have relevant changes:

- **New Features** — newly available functionality.
- **Performance Improvements** — speed, memory, rendering, responsiveness, and stability.
- **Interface & Animation Improvements** — visual interaction, layout, controls, and usability.
- **Fixes** — corrected broken or incorrect behavior.

## Release-note workflow

Before writing a changelog:

1. Review the changes made since the previous release or tag.
2. Check `BUGS.md` for resolved user-reported issues.
3. Separate user-visible changes from internal maintenance.
4. Explain why each technical change matters to the user.
5. Confirm the version matches the release tag exactly.
6. Read the final post once as a normal Bloom user and remove unnecessary implementation jargon.

## Reusable template

```markdown
# :BloomPetals: **Bloom Client — Patch Notes** :BloomPetals:

## **Version x.y.z**

### **New Features**

- Added ...

### **Performance Improvements**

- Improved ...

### **Interface & Animation Improvements**

- Added ...

### **Fixes**

- Fixed ...

*This update focuses on ...* :cherry_blossom:
```

## Complete example — Version 1.0.6

```markdown
# :BloomPetals: **Bloom Client — Patch Notes** :BloomPetals:

## **Version 1.0.6**

### **New Features**

- Added Modrinth browsing and one-click installation for **resource packs and shaders**, matching the existing mod browser inside each instance.
- Added a **Button Pop Duration** slider under Appearance, allowing button feedback to be adjusted from an instant press at `0 ms` up to a slower, more expressive press at `1000 ms`.

### **Performance Improvements**

- Replaced heavier **WebGL skin previews with optimized 2D rendering** where possible, significantly reducing graphics usage in the Skin Locker.
- Reduced unnecessary background work and expensive visual effects that could cause delays, freezing, or instability on lower-end computers.
- Removed artificial button-action delays so navigation and controls respond immediately.
- Moved button press feedback to a lightweight, hardware-accelerated animation path that does not force page layout or trigger unnecessary interface rerenders.
- Prevented repeated clicks from stacking animations and degrading performance.
- Improved general navigation, button responsiveness, and client stability in installed builds.

### **Interface & Animation Improvements**

- Restored smooth, visible button press feedback across Bloom Client while keeping every action immediate.
- Made the new button-duration setting respect both **Show Animations** and **Ultra Performance Mode**.
- Updated the account-switch confirmation interface so it always appears above surrounding content and is no longer clipped by the Settings page.
- Improved the Skin Locker's rendering efficiency without changing its overall appearance.

### **Fixes**

- Fixed the broken **Slim Arms** toggle in the Skin Locker and matched it with Bloom Client's standard toggle design.
- Fixed the custom **Close** button so it properly closes Bloom Client.
- Fixed **Show in Folder** opening Documents instead of the selected Minecraft instance.
- Fixed **Open Mods Folder** so it opens the selected instance's actual mods directory.
- Improved Windows folder-path handling for both older and newly created instances.

*Version 1.0.6 focuses on making Bloom Client faster, smoother, more responsive, and more reliable across a much wider range of computers.* :cherry_blossom:
```
