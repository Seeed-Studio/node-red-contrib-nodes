# Automatic Publishing GitHub Action

## Overview

This GitHub Action automatically checks for package version updates when creating a release, and publishes to npm if versions have changed.

## Configuration Files

- `.github/workflows/publish-on-release.yml` - Main workflow file
- `.github/scripts/check-version-update.sh` - Version checking script

## Workflow

1. **Trigger**: Activated when a new GitHub Release is created
2. **Parallel Processing**: Simultaneously checks all packages (node-red-contrib-seeed-canbus, node-red-contrib-seeed-recamera, node-red-contrib-sscma)
3. **Version Check**: Compares package.json versions between current release and previous release
4. **Duplicate Check**: Verifies if the version already exists on npm
5. **Auto Publish**: Automatically publishes if version is updated and doesn't exist on npm

## Setup Instructions

### 1. Configure NPM Token

Add NPM access token to GitHub repository settings:

1. Visit [npm website](https://www.npmjs.com/) and log in
2. Click avatar → Access Tokens → Generate New Token
3. Select "Automation" type token
4. Copy the generated token
5. In GitHub repository, go to Settings → Secrets and variables → Actions
6. Click "New repository secret"
7. Name: `NPM_TOKEN`
8. Value: Paste your npm token

### 2. Ensure Package Configuration

Make sure each package's `package.json` contains correct information:

```json
{
  "name": "package-name",
  "version": "version-number",
  "repository": {
    "type": "git",
    "url": "https://github.com/Seeed-Studio/node-red-contrib-nodes.git",
    "directory": "package-directory-name"
  }
}
```

## Usage

1. **Update Package Version**: Modify the version number in the package's `package.json`
2. **Commit Changes**: Commit all changes to the main branch
3. **Create Release**: Create a new release on GitHub
4. **Auto Publish**: GitHub Action will automatically check and publish packages with version updates

## Logging and Monitoring

- Action logs are displayed on the GitHub Actions page after execution
- Processing results for each package are shown in the Action Summary
- You can view whether publishing succeeded or the reason for skipping

## Supported Packages

Currently configured packages:
- `node-red-contrib-seeed-canbus`
- `node-red-contrib-seeed-recamera` 
- `node-red-contrib-sscma`

To add new packages, modify the matrix.package list in `.github/workflows/publish-on-release.yml`.

## Troubleshooting

### Common Issues

1. **Publishing Failed**: Check if NPM_TOKEN is configured correctly
2. **Version Check Failed**: Ensure git history is complete, workflow uses `fetch-depth: 0`
3. **Permission Issues**: Ensure npm token has publishing permissions

### Manual Publishing

If automatic publishing fails, you can publish manually:

```bash
cd package-directory
npm publish --access public
```
