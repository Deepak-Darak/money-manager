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

## Google SSO + Google Sheets Sync Setup

The app now includes a Cloud Sync section on Dashboard for Google login and cross-device data sync.

1. Create a Google OAuth Client ID (Web application) in Google Cloud Console.
2. Add your app URL (for example your GitHub Pages URL) to authorized JavaScript origins.
3. Create a Google Sheet and open Extensions > Apps Script.
4. Paste the script from `google-apps-script/Code.gs`.
5. In Apps Script, set Script Properties:
	1. `GOOGLE_CLIENT_ID` = your OAuth client ID
6. Deploy Apps Script as Web App:
	1. Execute as: Me
	2. Who has access: Anyone
7. Copy the deployed Web App URL.
8. In app Dashboard > Cloud Sync:
	1. Paste Google OAuth Client ID
	2. Paste Apps Script Web App URL
	3. Sign in with Google
	4. Use Pull/Push buttons (auto-push also runs after local changes)
