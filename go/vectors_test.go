package baseh

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"strings"
	"testing"
)

type vectorFile struct {
	Version  string          `json:"version"`
	Profiles []vectorProfile `json:"profiles"`
	Vectors  []struct {
		ProfileID     string `json:"profileId"`
		ID            string `json:"id"`
		CanonicalCode string `json:"canonicalCode"`
		RawBody       string `json:"rawBody"`
		RawChecksum   string `json:"rawChecksum"`
		Input         string `json:"input"`
		Note          string `json:"note"`
	} `json:"vectors"`
	Errors []struct {
		ProfileID string `json:"profileId"`
		Input     string `json:"input"`
		Error     string `json:"error"`
	} `json:"errors"`
	EncodeErrors []struct {
		ProfileID string `json:"profileId"`
		ID        string `json:"id"`
		Error     string `json:"error"`
	} `json:"encodeErrors"`
	ProfileErrors []struct {
		Note       string  `json:"note"`
		Error      string  `json:"error"`
		Definition Profile `json:"definition"`
	} `json:"profileErrors"`
	Correction []struct {
		ProfileID        string `json:"profileId"`
		ConfusionProfile string `json:"confusionProfile"`
		Input            string `json:"input"`
		ExpectedBody     string `json:"expectedBody"`
		Corrected        bool   `json:"corrected"`
		Error            string `json:"error"`
	} `json:"correction"`
}

type vectorProfile struct {
	ProfileID  string  `json:"profileId"`
	Definition Profile `json:"definition"`
	Capacity   string  `json:"capacity"`
}

type feistelVectorFile struct {
	Version string `json:"version"`
	Vectors []struct {
		ProfileID   string `json:"profileId"`
		KeyBytesHex string `json:"keyBytesHex"`
		Capacity    string `json:"capacity"`
		Rounds      int    `json:"rounds"`
		// Length is expandable mode only (spec 19.4): the generation's
		// total code length mixed into the round message.
		Length   *int   `json:"length"`
		Input    string `json:"input"`
		Permuted string `json:"permuted"`
	} `json:"vectors"`
}

func loadJSON(t *testing.T, path string, out any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
}

func parseBig(t *testing.T, s string) *big.Int {
	t.Helper()
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		t.Fatalf("bad decimal %q", s)
	}
	return v
}

func buildVectorProfiles(t *testing.T, vf vectorFile) map[string]*Codec {
	t.Helper()
	codecs := make(map[string]*Codec)
	for _, vp := range vf.Profiles {
		h, err := New(vp.Definition)
		if err != nil {
			t.Fatalf("profile %s rejected: %v", vp.ProfileID, err)
		}
		// Expandable profiles carry no single capacity (spec 12.3); the
		// vector file leaves the field empty for them.
		if vp.Capacity != "" {
			capacity, err := h.Capacity()
			if err != nil {
				t.Fatalf("profile %s capacity: %v", vp.ProfileID, err)
			}
			if got := capacity.String(); got != vp.Capacity {
				t.Fatalf("profile %s capacity %s, want %s", vp.ProfileID, got, vp.Capacity)
			}
		}
		codecs[vp.ProfileID] = h
	}
	return codecs
}

func unformat(vf vectorFile, profileID, code string) string {
	for _, vp := range vf.Profiles {
		if vp.ProfileID == profileID {
			sep := vp.Definition.Separator
			if sep == "" {
				return code
			}
			return strings.ReplaceAll(code, sep, "")
		}
	}
	return code
}

func TestConformanceVectors(t *testing.T) {
	var vf vectorFile
	loadJSON(t, "../vectors/vectors.json", &vf)
	codecs := buildVectorProfiles(t, vf)

	for _, v := range vf.Vectors {
		h := codecs[v.ProfileID]
		name := v.ProfileID + "/" + v.ID
		if v.Note != "" {
			name += "/" + strings.ReplaceAll(v.Note, " ", "_")
		}
		t.Run(name, func(t *testing.T) {
			id := parseBig(t, v.ID)

			code, err := h.Encode(id)
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			if code != v.CanonicalCode {
				t.Errorf("encode = %q, want %q", code, v.CanonicalCode)
			}
			raw := unformat(vf, v.ProfileID, code)
			if v.RawBody != "" && raw[:len(v.RawBody)] != v.RawBody {
				t.Errorf("raw body = %q, want %q", raw[:len(v.RawBody)], v.RawBody)
			}
			if v.RawChecksum != "" && raw[len(raw)-len(v.RawChecksum):] != v.RawChecksum {
				t.Errorf("raw checksum mismatch in %q, want %q", raw, v.RawChecksum)
			}

			input := v.CanonicalCode
			if v.Input != "" {
				input = v.Input
			}
			res, err := h.Decode(input, nil)
			if err != nil {
				t.Fatalf("decode %q: %v", input, err)
			}
			if res.ID.Cmp(id) != 0 {
				t.Errorf("decode id = %s, want %s", res.ID, id)
			}
			if res.CanonicalCode != v.CanonicalCode {
				t.Errorf("canonical = %q, want %q", res.CanonicalCode, v.CanonicalCode)
			}
			if res.Corrected {
				t.Errorf("unexpected corrected flag for %q", input)
			}
		})
	}
}

func TestConformanceErrors(t *testing.T) {
	var vf vectorFile
	loadJSON(t, "../vectors/vectors.json", &vf)
	codecs := buildVectorProfiles(t, vf)

	for _, e := range vf.Errors {
		t.Run(e.ProfileID+"/"+e.Input, func(t *testing.T) {
			_, err := codecs[e.ProfileID].Decode(e.Input, nil)
			if err == nil {
				t.Fatalf("decode %q succeeded, want %s", e.Input, e.Error)
			}
			var herr *BasehError
			if !errors.As(err, &herr) {
				t.Fatalf("error type %T, want *BasehError", err)
			}
			if string(herr.Code) != e.Error {
				t.Errorf("code = %s, want %s", herr.Code, e.Error)
			}
		})
	}
}

func TestConformanceEncodeErrors(t *testing.T) {
	var vf vectorFile
	loadJSON(t, "../vectors/vectors.json", &vf)
	codecs := buildVectorProfiles(t, vf)

	for _, e := range vf.EncodeErrors {
		t.Run(e.ProfileID+"/"+e.ID, func(t *testing.T) {
			_, err := codecs[e.ProfileID].Encode(parseBig(t, e.ID))
			if err == nil {
				t.Fatalf("encode %s succeeded, want %s", e.ID, e.Error)
			}
			var herr *BasehError
			if !errors.As(err, &herr) {
				t.Fatalf("error type %T, want *BasehError", err)
			}
			if string(herr.Code) != e.Error {
				t.Errorf("code = %s, want %s", herr.Code, e.Error)
			}
			if e.Error == string(BLOCKED_CODE) && herr.SafeForCustomer {
				t.Errorf("BLOCKED_CODE must not be safe for customer")
			}
		})
	}
}

func TestConformanceProfileErrors(t *testing.T) {
	var vf vectorFile
	loadJSON(t, "../vectors/vectors.json", &vf)

	for _, e := range vf.ProfileErrors {
		t.Run(e.Definition.ProfileID+"/"+strings.ReplaceAll(e.Note, " ", "_"), func(t *testing.T) {
			_, err := New(e.Definition)
			if err == nil {
				t.Fatalf("profile accepted, want %s", e.Error)
			}
			var herr *BasehError
			if !errors.As(err, &herr) || string(herr.Code) != e.Error {
				t.Errorf("error = %v, want code %s", err, e.Error)
			}
		})
	}
}

func TestConformanceCorrection(t *testing.T) {
	var vf vectorFile
	loadJSON(t, "../vectors/vectors.json", &vf)
	codecs := buildVectorProfiles(t, vf)

	for _, c := range vf.Correction {
		t.Run(c.ProfileID+"/"+c.Input, func(t *testing.T) {
			confusion := c.ConfusionProfile
			if confusion == "" {
				confusion = "light"
			}
			opts := &DecodeOptions{TryCorrection: true, ConfusionProfile: confusion}
			res, err := codecs[c.ProfileID].Decode(c.Input, opts)
			if c.Error != "" {
				if err == nil {
					t.Fatalf("decode succeeded, want %s", c.Error)
				}
				var herr *BasehError
				if !errors.As(err, &herr) || string(herr.Code) != c.Error {
					t.Errorf("error = %v, want code %s", err, c.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("decode: %v", err)
			}
			if res.Corrected != c.Corrected {
				t.Errorf("corrected = %v, want %v", res.Corrected, c.Corrected)
			}
			raw := unformat(vf, c.ProfileID, res.CanonicalCode)
			if !strings.HasPrefix(raw, c.ExpectedBody) {
				t.Errorf("canonical raw %q, want body %q", raw, c.ExpectedBody)
			}
			// Canonical stability: re-encoding the decoded id is idempotent.
			again, err := codecs[c.ProfileID].Encode(res.ID)
			if err != nil || again != res.CanonicalCode {
				t.Errorf("re-encode = %q, %v, want %q", again, err, res.CanonicalCode)
			}
		})
	}
}

func TestFeistelVectors(t *testing.T) {
	var ff feistelVectorFile
	loadJSON(t, "../vectors/feistel-vectors.json", &ff)

	for _, v := range ff.Vectors {
		t.Run(v.ProfileID+"/"+v.Capacity+"/"+v.Input, func(t *testing.T) {
			key := feistelKey{
				profileID: v.ProfileID,
				keyBytes:  mustHex(t, v.KeyBytesHex),
				rounds:    v.Rounds,
			}
			if v.Length != nil {
				key.length = *v.Length
				key.hasLength = true
			}
			capacity := parseBig(t, v.Capacity)
			input := parseBig(t, v.Input)
			want := parseBig(t, v.Permuted)

			got, err := permute(input, capacity, key)
			if err != nil {
				t.Fatalf("permute: %v", err)
			}
			if got.Cmp(want) != 0 {
				t.Errorf("permute(%s) = %s, want %s", input, got, want)
			}
			back, err := inversePermute(want, capacity, key)
			if err != nil {
				t.Fatalf("inversePermute: %v", err)
			}
			if back.Cmp(input) != 0 {
				t.Errorf("inversePermute(%s) = %s, want %s", want, back, input)
			}
		})
	}
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	out, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad hex %q: %v", s, err)
	}
	return out
}
