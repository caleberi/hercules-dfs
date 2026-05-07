// Package filesystem provides tests for the FileSystem type using the testify package.
package filesystem

import (
	"log"
	"os"
	"testing"

	"github.com/caleberi/distributed-system/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestFS(t *testing.T) (*FileSystem, func()) {
	t.Helper()
	root, err := os.MkdirTemp("", "fs-test-*")
	require.NoError(t, err, "failed to create temporary directory")
	fs := NewFileSystem(root)
	return fs, func() {
		require.NoError(t, os.RemoveAll(root), "failed to clean up temporary directory")
	}
}

func TestCreateDir(t *testing.T) {
	fs, cleanup := setupTestFS(t)
	defer cleanup()

	paths := []string{
		".", "",
		"../.",
		"test1", "test1/app_1",
		"test1/app_2", "test1/app_1/test2",
		"test3/.op/../../../../k",
	}

	common.ForEachInSlice(paths, func(p string) {
		assert.NoError(t, fs.MkDir(p))
	})
}

func TestCreateFile(t *testing.T) {
	fs, cleanup := setupTestFS(t)
	defer cleanup()

	paths := []string{"test1.txt", "dir1/test2.txt", "dir1/subdir/test3.txt"}
	require.NoError(t, fs.MkDir("dir1/subdir"), "failed to create parent directories")

	common.ForEachInSlice(paths, func(p string) {
		assert.NoError(t, fs.CreateFile(p), "failed to create file %s", p)
		info, err := fs.GetStat(p)
		assert.NoError(t, err, "failed to stat file %s", p)
		assert.True(t, info.Mode().IsRegular(), "path %s is not a regular file", p)
	})

	err := fs.CreateFile(paths[0])
	log.Printf("%s", err)
	assert.Error(t, err, "expected error when creating existing file %s", paths[0])
}

func TestDeleteFile(t *testing.T) {
	fs, cleanup := setupTestFS(t)
	defer cleanup()

	paths := []string{"test1.txt", "dir1/test2.txt", "dir1/subdir/test3.txt"}
	require.NoError(t, fs.MkDir("dir1/subdir"), "failed to create parent directories")
	common.ForEachInSlice(paths, func(p string) {
		require.NoError(t, fs.CreateFile(p), "failed to create file %s", p)
	})

	common.ForEachInSlice(paths, func(p string) {
		assert.NoError(t, fs.RemoveFile(p), "failed to remove file %s", p)
		_, err := fs.GetStat(p)
		assert.Error(t, err, "expected error when stating deleted file %s", p)
	})
	err := fs.RemoveFile("nonexistent.txt")
	assert.Error(t, err, "expected error when deleting nonexistent file")
}

func TestRemoveDir(t *testing.T) {
	fs, cleanup := setupTestFS(t)
	defer cleanup()

	require.NoError(t, fs.MkDir("testdir/subdir"), "failed to create directories")
	require.NoError(t, fs.CreateFile("testdir/file.txt"), "failed to create file")

	err := fs.RemoveDir("testdir")
	assert.NoError(t, err, "failed to remove directory testdir")

	_, err = fs.GetStat("testdir")
	assert.Error(t, err, "expected error when stating deleted directory")
	assert.False(t, os.IsExist(err), "expected not exist error for deleted directory")

	require.NoError(t, fs.CreateFile("file.txt"), "failed to create file")
	err = fs.RemoveDir("file.txt")
	assert.Error(t, err, "expected error when removing non-directory path")
}

func TestRename(t *testing.T) {
	fs, cleanup := setupTestFS(t)
	defer cleanup()

	require.NoError(t, fs.CreateFile("old.txt"), "failed to create file")
	err := fs.Rename("old.txt", "new.txt")
	assert.NoError(t, err, "failed to rename file")

	_, err = fs.GetStat("old.txt")
	assert.Error(t, err, "expected error when stating renamed file")
	assert.False(t, os.IsExist(err), "expected not exist error for old file")

	info, err := fs.GetStat("new.txt")
	assert.NoError(t, err, "failed to stat renamed file")
	assert.True(t, info.Mode().IsRegular(), "renamed path is not a regular file")

	require.NoError(t, fs.MkDir("olddir"), "failed to create directory")
	assert.NoError(t, fs.Rename("olddir", "newdir"), "failed to rename directory")

	_, err = fs.GetStat("olddir")
	assert.Error(t, err, "expected error when stating renamed directory")
	assert.False(t, os.IsExist(err), "expected not exist error for old directory")

	info, err = fs.GetStat("newdir")
	assert.NoError(t, err, "failed to stat renamed directory")
	assert.True(t, info.IsDir(), "renamed path is not a directory")

	require.NoError(t, fs.CreateFile("existing.txt"), "failed to create existing file")
	assert.NoError(t, fs.Rename("new.txt", "existing.txt"), "expected error when renaming to existing path")
	assert.Error(t, fs.Rename("nonexistent.txt", "newname.txt"), "expected error when renaming nonexistent path")
}
