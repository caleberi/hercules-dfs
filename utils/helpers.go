package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/rand"
	"strings"

	"github.com/caleberi/distributed-system/common"
)

func ExtractFromMap[K, V comparable](data map[K]V, fn func(value V) bool) map[K]V {
	result := make(map[K]V)
	for k, v := range data {
		if fn(v) {
			result[k] = v
		}
	}
	return result
}

// TransformSlice applies a transformation function to each element of a slice
func TransformSlice[T, V any](slice []T, transform func(T) V) []V {
	result := make([]V, 0, len(slice))
	for _, item := range slice {
		result = append(result, transform(item))
	}
	return result
}

// ForEachInSlice executes a function for each element in a slice
func ForEachInSlice[T any](slice []T, action func(T)) {
	for _, item := range slice {
		action(item)
	}
}

// IterateOverMap executes a function for each key-value pair in a map
func IterateOverMap[K comparable, V any](m map[K]V, action func(K, V)) {
	for k, v := range m {
		action(k, v)
	}
}

// FilterMapToNew creates a new map with key-value pairs that satisfy a predicate
func FilterMapToNew[K, V comparable](m map[K]V, predicate func(V) bool) map[K]V {
	result := make(map[K]V)
	for k, v := range m {
		if predicate(v) {
			result[k] = v
		}
	}
	return result
}

// FilterSlice returns a new slice with elements that satisfy a predicate
func FilterSlice[T any](slice []T, predicate func(T) bool) []T {
	result := make([]T, 0)
	for _, item := range slice {
		if predicate(item) {
			result = append(result, item)
		}
	}
	return result
}

// ReduceSlice reduces a slice to a single value using an accumulator function
func ReduceSlice[T, V any](slice []T, initial V, accumulator func(V, T) V) V {
	result := initial
	for _, item := range slice {
		result = accumulator(result, item)
	}
	return result
}

// FindInSlice returns the first element in a slice that satisfies a predicate
func FindInSlice[T any](slice []T, predicate func(T) bool) (T, bool) {
	for _, item := range slice {
		if predicate(item) {
			return item, true
		}
	}
	var zero T
	return zero, false
}

// GroupByKey groups slice elements by a key derived from each element
func GroupByKey[T any, K comparable](slice []T, keyFunc func(T) K) map[K][]T {
	result := make(map[K][]T)
	for _, item := range slice {
		key := keyFunc(item)
		result[key] = append(result[key], item)
	}
	return result
}

// ChunkSlice splits a slice into chunks of a specified size
func ChunkSlice[T any](slice []T, chunkSize int) [][]T {
	var chunks [][]T
	for i := 0; i < len(slice); i += chunkSize {
		end := i + chunkSize
		if end > len(slice) {
			end = len(slice)
		}
		chunks = append(chunks, slice[i:end])
	}
	return chunks
}

type Pair[T, U any] struct {
	First  T
	Second U
}

// ZipSlices combines elements from two slices into pairs
func ZipSlices[T, U any](slice1 []T, slice2 []U) []Pair[T, U] {
	minLen := min(len(slice1), len(slice2))
	result := make([]Pair[T, U], minLen)
	for i := range minLen {
		result[i] = Pair[T, U]{First: slice1[i], Second: slice2[i]}
	}
	return result
}

func Sum(slice []float64) float64 {
	total := 0.0
	for i := range slice {
		total += slice[i]
	}
	return total
}

func Sample(n, k int) ([]int, error) {
	if n < k {
		return nil, fmt.Errorf("population is not enough for sampling (n = %d, k = %d)", n, k)
	}
	return rand.Perm(n)[:k], nil
}

func ComputeChecksum(content string) string {
	hash := sha256.New()
	hash.Write([]byte(content))
	checksum := hash.Sum(nil)
	return hex.EncodeToString(checksum)
}

// ValidateFilename checks if the given filename is valid for use in the namespace.
// It returns an error if the filename is empty or a reserved name like "." or "..".
func ValidateFilename(filename string, path common.Path) error {
	if filename == "" || filename == "." || filename == ".." {
		return fmt.Errorf("invalid filename %q: reserved name", filename)
	}

	if strings.ContainsAny(filename, "/\\") {
		return fmt.Errorf("invalid filename %q: contains path separator", filename)
	}

	if strings.Contains(filename, "\x00") {
		return fmt.Errorf("invalid filename %q: contains null byte", filename)
	}

	for _, r := range filename {
		if r < 32 {
			return fmt.Errorf("invalid filename %q: contains control character", filename)
		}
	}

	return nil
}

// BToMb converts bytes to megabytes with floating-point precision.
// It divides the input bytes by 1024*1024 to convert to megabytes, used in the distributed storage system
// to report memory statistics (e.g., in RPCSysReportHandler). The function ensures non-negative input and
// returns a floating-point value to preserve precision, avoiding truncation from integer division.
//
// Parameters:
//   - b: The number of bytes to convert (non-negative uint64).
//
// Returns:
//   - A float64 representing the number of megabytes.
//   - An error if the input is too large (unlikely with uint64).
func BToMb(b uint64) float64 {
	return float64(b) / (1024 * 1024)
}
