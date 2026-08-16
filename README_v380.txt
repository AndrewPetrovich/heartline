HEARTLINE Editor 3.8 — Preview Lab

Highlights
----------
• Responsive single-device Preview: Fit / 50 / 75 / 100 / 125%.
• 9 representative viewport profiles across iOS, Android and Foldable classes.
• Custom viewport with custom safe-area insets.
• User-selectable comparison of up to four profiles.
• Comparison presets: Essential / iOS / Android / Edge cases.
• Safe-area / cutout / fold-hinge visualization.
• Drag focal point directly on the image.
• Ctrl/Command + mouse wheel changes crop zoom.
• Stronger diagnostics and a cross-device readiness matrix.
• "Open in Reader" becomes "Open in proofreading".
• Device geometry is injected through DeviceProfileService instead of renderer hardcode.
• Runtime export now carries modular StoryProfile / DeviceProfile dependencies.

Apply
-----
See APPLY_3_8.md. Extract over HEARTLINE 3.7.1 and run:

node .\tools\apply-preview-lab-3.8.mjs
npm.cmd run verify-repository
npm.cmd test
npm.cmd run check
