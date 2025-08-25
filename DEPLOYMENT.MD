# 🚀 Deployment & Auto-Versioning Guide for @vorthain/vortex

This project uses **automatic versioning and publishing** based on commit messages. Here's how it works:

## 🔍 Commit Message Rules

Your commit message determines what happens:

### 🐛 **Patch Version** (1.0.0 → 1.0.1)

```bash
git commit -m "fix: memory leak in RequestBuilder"
git commit -m "bug: handle edge case in XHR progress tracking"
git commit -m "patch: improve error handling in Node.js"
```

### ✨ **Minor Version** (1.0.0 → 1.1.0)

```bash
git commit -m "feat: add real progress tracking with XHR"
git commit -m "feature: support for GET requests with body"
```

### 💥 **Major Version** (1.0.0 → 2.0.0)

```bash
git commit -m "BREAKING: change client configuration API"
git commit -m "breaking: remove deprecated cache methods"
git commit -m "feat: new interceptor API [breaking]"
```

### ⭐️ **Skip Publishing** (no version change)

```bash
git commit -m "docs: update README [skip]"
git commit -m "style: fix formatting"
git commit -m "refactor: clean up RequestBuilder code"
git commit -m "test: add more progress tracking tests"
git commit -m "chore: update dependencies"
```

## 📄 Auto-Publishing Workflow

### For All Pushes & Pull Requests:

1. **Continuous Integration runs:**
   - ✅ **Tests with coverage** (`npm run test:ci`)
   - ✅ Verifies pure JS library works correctly

### For Pushes to Main Branch Only:

2. **After CI passes, Publishing runs:**
   - 🔍 **Analyzes commit message**
   - 📈 **Auto-bumps version** in package.json
   - 🏷️ **Creates git tag** (e.g., v1.2.3)
   - 📦 **Publishes to npm** 🎉

## 🧪 Testing & Coverage

### Local Development

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Open coverage report in browser
open coverage/lcov-report/index.html
```

### Coverage Requirements

Your tests must maintain:

- **70%** branch coverage
- **75%** function coverage
- **75%** line coverage
- **75%** statement coverage

**If coverage drops below these thresholds, publishing will fail!**

## 🎯 Examples

### Publishing a Bug Fix

```bash
git add .
git commit -m "fix: resolve XMLHttpRequest not defined error in tests"
git push origin main
# → Runs tests → If pass → Publishes v1.0.1 automatically
```

### Adding a New Feature

```bash
git add .
git commit -m "feat: add environment detection for universal support"
git push origin main
# → Runs tests → If pass → Publishes v1.1.0 automatically
```

### Breaking Changes

```bash
git add .
git commit -m "BREAKING: change progress callback signature"
git push origin main
# → Runs tests → If pass → Publishes v2.0.0 automatically
```

### Documentation Changes (No Publish)

```bash
git add .
git commit -m "docs: improve progress tracking examples [skip]"
git push origin main
# → Runs tests only, no version bump, no publish
```

## 🛠️ Manual Override

If you need to manually control versioning:

```bash
# Bump version manually
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0

# Then commit and push
git push origin main --tags
# → Will publish the manually set version
```

## 🔧 Setup Requirements

### 1. GitHub Secrets needed:

Go to your repo → Settings → Secrets and variables → Actions → New repository secret:

- **Name**: `NPM_TOKEN`
- **Value**: Your npm automation token

### 2. Get NPM Token:

```bash
# Login to npm
npm login

# Create automation token
npm token create --type=automation
# Copy the token and add it to GitHub secrets
```

### 3. File locations:

- `.github/workflows/publish.yml` (the workflow file)
- `package.json` (updated with coverage thresholds)

## 📊 What Gets Published

Since this is a **pure JavaScript library**, we publish the source files directly:

- ✅ `src/` folder (all source files)
- ✅ `index.js` (main entry point)
- ✅ `README.md`
- ✅ `LICENSE`
- ❌ Tests (`src/**/*.test.js`)
- ❌ Config files
- ❌ Coverage reports
- ❌ `node_modules/`

## 🚨 Important Notes

- **Only pushes to `main` branch trigger publishing**
- **Pull requests only run tests** (no publishing)
- **Failed tests = no publishing** ❌
- **Low coverage = no publishing** ❌
- **Each push can only publish once** (no duplicate versions)
- **Pure JS means no build step** - source files are published directly

## 🎯 Best Practices for Vortex

1. **Write tests for new features** - Coverage requirements enforced!
2. **Test in both browser and Node.js environments**
3. **Use descriptive commit messages**
4. **Test progress tracking features manually in browser**
5. **Use `[skip]` for non-code changes**
6. **Test locally before pushing** (`npm run test:coverage`)
7. **Check the Actions tab** to see publish status
8. **Keep coverage above thresholds**

## 🛠️ Vortex-Specific Testing

```bash
# Test the library works universally
npm test

# Test progress tracking (will show Node.js limitations)
npm run test:coverage

# Manually test in browser (create a simple HTML file):
# <script type="module">
#   import { createVortexClient } from './index.js';
#   const client = createVortexClient({...});
#   // Test real progress tracking
# </script>
```

## 🌍 Universal Compatibility

Your library works in:

- ✅ **Browser** (with real progress tracking)
- ✅ **Node.js 18+** (with fetch, limited progress)
- ✅ **Node.js <18** (with node-fetch polyfill)
- ✅ **Bundlers** (Webpack, Vite, Rollup, etc.)
- ✅ **SSR frameworks** (Next.js, Nuxt, SvelteKit)

## 🛡️ Troubleshooting

### Tests Failing?

```bash
# Run locally to debug
npm run test:coverage
# Check if it's XMLHttpRequest-related (Node.js environment)
```

### Coverage Too Low?

```bash
# See detailed coverage report
npm run test:coverage
open coverage/lcov-report/index.html
# Add tests for RequestBuilder methods
```

### NPM Token Issues?

```bash
# Verify token has correct permissions
npm whoami
# Should show your npm username

# Check if token is automation type
# Automation tokens can publish from CI/CD
```

---

**Need help?** Check the GitHub Actions logs in the "Actions" tab of your repo.

**First time setup checklist:**

- [ ] Add `NPM_TOKEN` to GitHub repository secrets
- [ ] Verify you're a maintainer of the `@vorthain/vortex` package on npm
- [ ] Test locally with `npm run test:coverage`
- [ ] Push with a commit message like `feat: initial release` to test workflow
