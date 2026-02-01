# Contributing to Hercules

Thank you for your interest in contributing to Hercules! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Process](#development-process)
- [Coding Standards](#coding-standards)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Community](#community)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors.

### Expected Behavior

- Be respectful and considerate
- Use welcoming and inclusive language
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment or discrimination of any kind
- Trolling or insulting comments
- Public or private harassment
- Publishing others' private information

## Getting Started

### Prerequisites

1. **Go**: Version 1.18 or higher
2. **Git**: For version control
3. **Docker**: For testing (optional but recommended)
4. **Redis**: For running failure detector tests

### Fork and Clone

```bash
# Fork the repository on GitHub
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/hercules-dfs.git
cd hercules-dfs

# Add upstream remote
git remote add upstream https://github.com/caleberi/hercules-dfs.git
```

### Build and Test

```bash
# Install dependencies
go mod download

# Build
go build -o bin/hercules main.go

# Run tests
go test ./...

# Run with Docker
docker-compose up --build
```

## Development Process

### 1. Create an Issue

Before starting work:
- Check if an issue already exists
- Create a new issue describing the bug/feature
- Wait for maintainer feedback
- Get assigned to the issue

### 2. Create a Branch

```bash
# Update your fork
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/bug-description
```

### 3. Make Changes

- Write code following our [coding standards](#coding-standards)
- Add tests for new functionality
- Update documentation if needed
- Keep commits focused and atomic

### 4. Commit Your Changes

```bash
# Stage changes
git add .

# Commit with descriptive message
git commit -m "feat: add new feature

Detailed description of what changed and why.

Fixes #123"
```

#### Commit Message Format

```
<type>: <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks
- `style`: Code style changes (formatting)

**Examples**:
```
feat: add support for custom chunk sizes

Added configuration option to allow users to specify
chunk size at startup. Defaults to 64MB.

Closes #45
```

```
fix: resolve race condition in lease management

Added mutex lock to prevent concurrent access to
lease map during extension operations.

Fixes #78
```

### 5. Push and Create Pull Request

```bash
# Push to your fork
git push origin feature/your-feature-name

# Create Pull Request on GitHub
```

## Coding Standards

### Go Code Style

Follow standard Go conventions:

```bash
# Format code
go fmt ./...

# Organize imports
goimports -w .

# Run linter
golangci-lint run
```

### Code Organization

```go
// Good: Clear package documentation
// Package chunkserver implements the storage node for Hercules DFS.
// It handles chunk storage, replication, and serves read/write requests.
package chunkserver

// Good: Exported functions have comments
// CreateChunk creates a new chunk with the given handle.
// Returns error if chunk already exists.
func CreateChunk(handle ChunkHandle) error {
    // Implementation
}

// Good: Meaningful variable names
chunkHandle := generateHandle()
replicaServers := getReplicaLocations(chunkHandle)

// Bad: Single letter variables (except in short loops)
h := generateHandle()
r := getReplicaLocations(h)
```

### Error Handling

```go
// Good: Return errors, don't panic
func readChunk(handle ChunkHandle) ([]byte, error) {
    data, err := os.ReadFile(getChunkPath(handle))
    if err != nil {
        return nil, fmt.Errorf("failed to read chunk %d: %w", handle, err)
    }
    return data, nil
}

// Good: Wrap errors with context
if err != nil {
    return fmt.Errorf("failed to process mutation: %w", err)
}
```

### Testing

```go
// Test function naming
func TestCreateChunk(t *testing.T) {
    // Setup
    handle := ChunkHandle(123)
    
    // Execute
    err := CreateChunk(handle)
    
    // Assert
    if err != nil {
        t.Errorf("CreateChunk failed: %v", err)
    }
}

// Table-driven tests
func TestValidateChunkSize(t *testing.T) {
    tests := []struct {
        name    string
        size    int64
        wantErr bool
    }{
        {"valid size", 1024, false},
        {"too large", ChunkMaxSizeInByte + 1, true},
        {"negative", -1, true},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateChunkSize(tt.size)
            if (err != nil) != tt.wantErr {
                t.Errorf("ValidateChunkSize() error = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

### Comments

```go
// Good: Package comment
// Package master_server implements the metadata server for Hercules DFS.
// It manages namespace, chunk locations, and coordinates chunkservers.
package master_server

// Good: Struct comment with field descriptions
// ChunkInfo represents metadata about a chunk in the file system.
type ChunkInfo struct {
    // Handle is the unique identifier for this chunk
    Handle ChunkHandle
    
    // Version tracks the current version for consistency
    Version ChunkVersion
    
    // Locations lists all chunkservers storing this chunk
    Locations []ServerAddr
}

// Good: Function comment with parameters and return values
// GetChunkLocation returns the list of chunkservers storing the given chunk.
//
// Parameters:
//   - handle: The unique chunk identifier
//
// Returns:
//   - []ServerAddr: List of chunkserver addresses
//   - error: Error if chunk not found
func GetChunkLocation(handle ChunkHandle) ([]ServerAddr, error) {
    // Implementation
}
```

## Pull Request Process

### Before Submitting

- [ ] Code compiles without errors
- [ ] All tests pass (`go test ./...`)
- [ ] No linter warnings (`golangci-lint run`)
- [ ] Code is formatted (`go fmt ./...`)
- [ ] Documentation is updated
- [ ] Commit messages follow conventions
- [ ] PR description is clear and complete

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How has this been tested?

## Checklist
- [ ] Tests pass locally
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
- [ ] Follows code style guidelines
```

### Review Process

1. **Automated Checks**: CI runs tests and linters
2. **Maintainer Review**: Code review by maintainers
3. **Revisions**: Address feedback
4. **Approval**: Get approval from maintainer
5. **Merge**: Maintainer merges PR

### After Merge

- Delete your branch
- Update your fork
- Close related issues

## Reporting Bugs

### Before Reporting

- Search existing issues
- Verify it's reproducible
- Check if it's already fixed in main

### Bug Report Template

```markdown
**Describe the Bug**
Clear description of what the bug is

**To Reproduce**
Steps to reproduce:
1. Start services with '...'
2. Call API endpoint '...'
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- OS: [e.g., Ubuntu 20.04]
- Go Version: [e.g., 1.21]
- Docker Version: [e.g., 20.10.8]
- Hercules Version/Commit: [e.g., main@abc123]

**Logs**
```
Paste relevant logs here
```

**Additional Context**
Any other relevant information
```

## Suggesting Features

### Feature Request Template

```markdown
**Feature Description**
Clear description of the proposed feature

**Use Case**
Why is this feature needed?

**Proposed Solution**
How should this feature work?

**Alternatives Considered**
Other approaches you've thought about

**Additional Context**
Any other relevant information
```

## Areas for Contribution

### Good First Issues

Look for issues tagged with `good-first-issue`:
- Documentation improvements
- Adding tests
- Minor bug fixes
- Code cleanup

### High Priority

- Performance optimizations
- Additional tests (especially integration tests)
- Error handling improvements
- Monitoring and observability

### Nice to Have

- Web UI for administration
- Additional API endpoints
- Example applications
- Kubernetes deployment manifests

## Community

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Questions and general discussion
- **Pull Requests**: Code contributions

### Getting Help

- Read the [documentation](docs/)
- Search existing issues
- Ask in GitHub Discussions
- Tag maintainers if urgent

## Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Credited in relevant documentation

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Hercules! 🎉
