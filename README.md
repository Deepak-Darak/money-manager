# Money Manager

A modern personal finance tracker inspired by Money Manager style apps.

## Features

- Add income and expense transactions
- Category-wise transaction management
- Filter by month, type, and category
- Dashboard cards for income, expenses, balance, and budget usage
- Expense distribution chart
- Local storage persistence (your data stays in browser)
- Responsive layout for desktop and mobile

## Run Locally

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Deploy Without Local Install (GitHub Pages)

If your system cannot install dependencies, use GitHub Actions to build and host for you.

1. Create an empty GitHub repository.
2. Push this project to the repository on the main branch.
3. In GitHub repository settings, open Pages and set Source to GitHub Actions.
4. The workflow file at .github/workflows/deploy-pages.yml will install, build, and deploy automatically.
5. Your live URL will be shown in the workflow summary after deployment.

## Build for Production

```bash
npm run build
npm run preview
```

## Install on iPhone

After deploying the site, you can install it from Safari like an app.

1. Open the live URL in Safari on iPhone.
2. Tap the Share button.
3. Choose Add to Home Screen.
4. Launch it from the home screen for a standalone app experience.

Notes:

1. The app now includes a web manifest, service worker, and iPhone web-app metadata.
2. After each deploy, close and reopen the installed app if Safari is still showing an older cached version.

## iOS App with Capacitor

This project is wired for Capacitor so you can wrap the existing Vite app as a native iOS app.

One-time setup:

```bash
npm install
npx cap add ios
```

Open in Xcode:

```bash
npm run ios
```

Manual sync after web changes:

```bash
npm run build
npm run cap:sync
npm run cap:open:ios
```

Notes:

1. GitHub Pages still uses `/money-manager/` as the web base path.
2. Capacitor builds use a relative base path automatically.
3. The generated `ios/` folder is created after `npx cap add ios`.

## Password Login + Google Sheets Sync

The app now enforces sign-in first and users enter their email plus a shared app password. All data syncs through a central Google Sheet.

Owner setup (one time):

1. Create a Google Sheet and open Extensions > Apps Script.
2. Paste `google-apps-script/Code.gs`.
3. In Apps Script Script Properties, set:
	1. `APP_PASSWORD` = the password users should enter in the app
4. Deploy Apps Script Web App:
	1. Execute as: Me
	2. Access: Anyone
5. Copy Web App URL.
6. Set this Vite env variable in the project build environment:
	1. `VITE_SYNC_ENDPOINT`

Runtime behavior:

1. User visits app -> sees email and password sign-in gate.
2. User enters email and the shared app password.
3. Apps Script verifies the password and uses the email as the row key.
4. App pulls that user's row from your central Google Sheet.
5. App auto-syncs updates back to your sheet, enabling cross-device continuity.
