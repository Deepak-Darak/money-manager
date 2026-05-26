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

## One-Click Google SSO + Central Google Sheets Setup

The app now enforces sign-in first and users only click Google sign-in. They are not asked to enter any config.

Owner setup (one time):

1. Create Google OAuth Client ID (Web app) in Google Cloud Console.
2. Add your production URL (GitHub Pages URL) in authorized JavaScript origins.
3. Create a Google Sheet and open Extensions > Apps Script.
4. Paste `google-apps-script/Code.gs`.
5. In Apps Script Script Properties, set:
	1. `GOOGLE_CLIENT_ID` = your OAuth client ID
6. Deploy Apps Script Web App:
	1. Execute as: Me
	2. Access: Anyone
7. Copy Web App URL.
8. Set these Vite env variables in the project build environment:
	1. `VITE_GOOGLE_CLIENT_ID`
	2. `VITE_SYNC_ENDPOINT`

Runtime behavior:

1. User visits app -> sees Google sign-in gate.
2. User clicks sign-in.
3. App identifies user by Google account.
4. App pulls that user's row from your central Google Sheet.
5. App auto-syncs updates back to your sheet, enabling cross-device continuity.
