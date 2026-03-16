# GitHub Setup Guide

This guide will help you push the Project WATCHTOWER repository to GitHub.

## Quick Setup

### 1. Create a GitHub Repository

1. Go to [GitHub](https://github.com/new)
2. Create a new repository named `project-watchtower` (or your preferred name)
3. **Do NOT** initialize with README, .gitignore, or license (we already have these)
4. Click "Create repository"

### 2. Add GitHub Remote

Copy your repository URL and run:

```bash
cd /app
git remote add origin https://github.com/YOUR_USERNAME/project-watchtower.git
```

Or if using SSH:

```bash
git remote add origin git@github.com:YOUR_USERNAME/project-watchtower.git
```

### 3. Push to GitHub

```bash
# Push main branch
git push -u origin main
```

If you encounter authentication issues:
- For HTTPS: You'll need a [Personal Access Token](https://github.com/settings/tokens)
- For SSH: Set up [SSH keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)

## What's Been Committed

The following has been committed to your local repository:

✅ **Commit:** `docs: Add comprehensive README for Project WATCHTOWER`

**Includes:**
- Complete project documentation
- All 9 tracked conflicts with statistics
- Data sources and API documentation
- Installation instructions
- Tech stack details
- Contributing guidelines
- Disclaimer and data accuracy notes

## Verify Your Commit

```bash
# View commit details
git log -1 --stat

# View changes
git diff HEAD~1 HEAD
```

## Branch Information

- **Current branch:** main
- **Commit SHA:** 6dd6535
- **Files changed:** README.md (381 insertions, 1 deletion)

## Next Steps After Pushing

1. **Add repository topics** on GitHub:
   - `conflict-monitoring`, `geopolitics`, `humanitarian`, `data-visualization`
   - `fastapi`, `react`, `mongodb`, `dashboard`

2. **Enable GitHub Pages** (optional):
   - Settings → Pages → Deploy from branch: main

3. **Add collaborators** (optional):
   - Settings → Collaborators → Add people

4. **Set up GitHub Actions** (optional):
   - For automated testing and deployment

## Continuous Integration Setup (Optional)

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on: [push, pull_request]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - run: |
          cd backend
          pip install -r requirements.txt
          # Add tests here
  
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: |
          cd frontend
          yarn install
          yarn build
```

## Troubleshooting

### Authentication Failed
```bash
# Use Personal Access Token for HTTPS
git remote set-url origin https://YOUR_TOKEN@github.com/YOUR_USERNAME/project-watchtower.git
```

### Large File Warning
If you get warnings about large files:
```bash
# Check file sizes
git ls-tree -r -t -l --full-name HEAD | sort -n -k 4 | tail -n 10

# Use Git LFS for large files (if needed)
git lfs install
git lfs track "*.zip"
```

## Additional Resources

- [GitHub Documentation](https://docs.github.com)
- [Git Basics](https://git-scm.com/book/en/v2/Getting-Started-Git-Basics)
- [Markdown Guide](https://www.markdownguide.org/)

---

**Ready to share your conflict monitoring dashboard with the world!**
