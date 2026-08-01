package baseh

import (
	"crypto/hmac"
	"crypto/sha256"
	"math/big"
	"strconv"
)

// Feistel-v1, spec 7.3. HMAC-SHA-256 round function, alternating half
// widths and cycle walking capped at 1000 iterations.

var feistelTag = []byte("BASEH-FEISTEL-V1")

const maxWalks = 1000

type feistelKey struct {
	profileID string
	keyBytes  []byte
	rounds    int
	// length is expandable mode only (spec 7.3/19.4): the total code
	// length L of the generation, mixed into the round message. hasLength
	// is false in fixed mode, where the message stays byte-for-byte
	// unchanged.
	length    int
	hasLength bool
}

// bitLength returns ceil(log2(capacity)) = bit length of capacity - 1.
func bitLength(capacity *big.Int) int {
	c := new(big.Int).Sub(capacity, big.NewInt(1))
	return c.BitLen()
}

// lowBits takes the first ceil(n/8) digest bytes as a big-endian integer
// and masks to n bits, per spec 7.3.
func lowBits(digest []byte, n int) *big.Int {
	byteCount := (n + 7) / 8
	v := new(big.Int).SetBytes(digest[:byteCount])
	if n > 0 {
		mask := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), uint(n)), big.NewInt(1))
		v.And(v, mask)
	}
	return v
}

// roundMessage builds the exact round input byte sequence of spec 7.3:
// tag, 0x00, profileId, 0x00, optional ASCII length + 0x00 (expandable
// mode only, spec 19.4), round byte, right in ceil(wr/8) big-endian
// bytes (zero bytes when wr is 0).
func roundMessage(key feistelKey, round int, right *big.Int, wr int) []byte {
	byteCount := (wr + 7) / 8
	rightBytes := make([]byte, byteCount)
	if byteCount > 0 {
		rb := right.Bytes()
		copy(rightBytes[byteCount-len(rb):], rb)
	}
	msg := make([]byte, 0, len(feistelTag)+1+len(key.profileID)+1+8+1+byteCount)
	msg = append(msg, feistelTag...)
	msg = append(msg, 0)
	msg = append(msg, key.profileID...)
	msg = append(msg, 0)
	if key.hasLength {
		msg = strconv.AppendInt(msg, int64(key.length), 10)
		msg = append(msg, 0)
	}
	msg = append(msg, byte(round))
	msg = append(msg, rightBytes...)
	return msg
}

func roundMAC(key feistelKey, msg []byte) []byte {
	mac := hmac.New(sha256.New, key.keyBytes)
	mac.Write(msg)
	return mac.Sum(nil)
}

type halves struct {
	left  *big.Int
	right *big.Int
}

func split(value *big.Int, w1 int) halves {
	mask := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), uint(w1)), big.NewInt(1))
	return halves{
		left:  new(big.Int).Rsh(new(big.Int).Set(value), uint(w1)),
		right: new(big.Int).And(value, mask),
	}
}

func combine(h halves, w1 int) *big.Int {
	out := new(big.Int).Lsh(h.left, uint(w1))
	return out.Or(out, h.right)
}

// runRounds applies the forward round sequence of spec 7.3 step 4.
func runRounds(h halves, key feistelKey, w0, w1 int) halves {
	left, right := h.left, h.right
	for i := 0; i < key.rounds; i++ {
		wr, wl := w1, w0
		if i%2 != 0 {
			wr, wl = w0, w1
		}
		f := lowBits(roundMAC(key, roundMessage(key, i, right, wr)), wl)
		left, right = right, new(big.Int).Xor(left, f)
	}
	return halves{left: left, right: right}
}

// runInverse applies the reverse round sequence of spec 7.3. The round that
// produced the current halves consumed a right value equal to the current
// left, so the message is rebuilt from left.
func runInverse(h halves, key feistelKey, w0, w1 int) halves {
	left, right := h.left, h.right
	for i := key.rounds - 1; i >= 0; i-- {
		wr, wl := w1, w0
		if i%2 != 0 {
			wr, wl = w0, w1
		}
		f := lowBits(roundMAC(key, roundMessage(key, i, left, wr)), wl)
		left, right = new(big.Int).Xor(right, f), left
	}
	return halves{left: left, right: right}
}

// permute runs the forward permutation with cycle walking.
func permute(value, capacity *big.Int, key feistelKey) (*big.Int, error) {
	bits := bitLength(capacity)
	w1 := bits / 2
	w0 := bits - w1
	v := new(big.Int).Set(value)
	for walk := 0; walk < maxWalks; walk++ {
		out := combine(runRounds(split(v, w1), key, w0, w1), w1)
		if out.Cmp(capacity) < 0 {
			return out, nil
		}
		v = out
	}
	return nil, newError(PERMUTATION_FAILURE, "Feistel cycle walking exceeded 1000 iterations", false)
}

// inversePermute runs the inverse permutation with cycle walking.
func inversePermute(value, capacity *big.Int, key feistelKey) (*big.Int, error) {
	bits := bitLength(capacity)
	w1 := bits / 2
	w0 := bits - w1
	v := new(big.Int).Set(value)
	for walk := 0; walk < maxWalks; walk++ {
		out := combine(runInverse(split(v, w1), key, w0, w1), w1)
		if out.Cmp(capacity) < 0 {
			return out, nil
		}
		v = out
	}
	return nil, newError(PERMUTATION_FAILURE, "Feistel cycle walking exceeded 1000 iterations", false)
}
