package utils

import (
	"bytes"
	"fmt"
	"io"
	"sync"
)

type Node[T any] struct {
	data T
	next *Node[T]
	prev *Node[T]
}

// Deque is a thread-safe double-ended queue supporting O(1) insertion
// and removal at both ends. It is safe for concurrent use by multiple
// goroutines.
//
// Example:
//
//	queue := Deque[int]{}
//	queue.PushBack(10)
//	val := queue.PopFront()
type Deque[T any] struct {
	mu     sync.RWMutex // for synchroncize access to queue
	head   *Node[T]
	tail   *Node[T]
	length int64
}

func (qs *Deque[T]) Length() int64 {
	qs.mu.RLock()
	defer qs.mu.RUnlock()
	return qs.length
}

func (qs *Deque[T]) PushFront(v T) {
	qs.mu.Lock()
	defer qs.mu.Unlock()

	node := Node[T]{
		data: v,
	}

	qs.length += 1
	if qs.head == nil && qs.tail == nil {
		qs.head = &node
		qs.tail = qs.head
		return
	}

	node.next = qs.head
	qs.head.prev = &node
	qs.head = &node

}

func (qs *Deque[T]) PushBack(v T) {
	qs.mu.Lock()
	defer qs.mu.Unlock()

	node := Node[T]{
		data: v,
	}

	qs.length += 1
	if qs.head == nil && qs.tail == nil {
		qs.head = &node
		qs.tail = qs.head

		return
	}

	qs.tail.next = &node
	node.prev = qs.tail
	qs.tail = &node

}

func (qs *Deque[T]) PopFront() T {
	qs.mu.Lock()
	defer qs.mu.Unlock()

	if qs.tail == nil && qs.head == nil {
		var zeroVal T
		return zeroVal
	}

	qs.length -= 1

	if qs.head.next == nil {
		v := qs.head.data
		qs.tail = nil
		qs.head = nil
		return v
	}

	node := qs.head
	qs.head = qs.head.next
	node.next = nil //  break the chain
	return node.data
}

func (qs *Deque[T]) PopBack() T {
	qs.mu.Lock()
	defer qs.mu.Unlock()

	if qs.tail == nil && qs.head == nil {
		var zeroVal T
		return zeroVal
	}

	qs.length -= 1
	if qs.tail.prev == nil {
		v := qs.tail.data
		qs.tail = nil
		qs.head = nil
		return v
	}

	node := qs.tail
	qs.tail = node.prev
	qs.tail.next = nil
	node.next = nil //  break the chain

	return node.data
}

func (qs *Deque[T]) PopAllReverse() []T {
	var ret []T
	for qs.Length() != 0 {
		ret = append(ret, qs.PopBack())
	}
	return ret
}

func (qs *Deque[T]) Print(w io.Writer) {
	qs.mu.RLock()
	defer qs.mu.RUnlock()

	buffer := bytes.NewBufferString("")
	for current := qs.head; current != nil; current = current.next {
		fmt.Fprintf(buffer, "%v ->", current.data)
	}
	buffer.WriteString("nil \n")
	w.Write(buffer.Bytes())
}

func (qs *Deque[T]) IsEmpty() bool {
	qs.mu.RLock()
	defer qs.mu.RUnlock()
	return qs.length == 0
}
