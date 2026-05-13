# GitHub Secrets Setup

To run this automation in GitHub Actions without exposing your credentials, follow these steps:

## 1. Go to your Repository Settings
On GitHub, navigate to your repository and click on **Settings** > **Secrets and variables** > **Actions**.

## 2. Add New Repository Secrets
Click on **New repository secret** for each of the following:

| Name | Value |
| :--- | :--- |
| `GRAFANA_BASE_DOMAIN` | `luxgroup.net` |
| `GRAFANA_USER` | `admin` |
| `GRAFANA_PASSWORD` | `prom-operator` |

## 3. Reference in GitHub Actions Workflow
In your `.github/workflows/main.yml` (or similar), you must map these secrets to environment variables so the script can see them:

```yaml
jobs:
  run-automation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: node grafana.js --project elx --env int --duration 30d
        env:
          GRAFANA_BASE_DOMAIN: ${{ secrets.GRAFANA_BASE_DOMAIN }}
          GRAFANA_USER: ${{ secrets.GRAFANA_USER }}
          GRAFANA_PASSWORD: ${{ secrets.GRAFANA_PASSWORD }}
```

> [!IMPORTANT]
> **Never** commit your `.env` file to GitHub. I have updated your `.gitignore` to ensure it is excluded.
