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
