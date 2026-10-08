package office2modoc

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
)

func generateOfflineToken(requestID string, timestamp int64) (string, error) {
	digest := md5.Sum([]byte(requestID))
	key := []byte(hex.EncodeToString(digest[:]))
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("office2modoc: create offline token cipher: %w", err)
	}

	plain := []byte(strconv.FormatInt(timestamp, 10))
	padding := aes.BlockSize - len(plain)%aes.BlockSize
	padded := make([]byte, len(plain)+padding)
	copy(padded, plain)
	for index := len(plain); index < len(padded); index++ {
		padded[index] = byte(padding)
	}

	cipher.NewCBCEncrypter(block, key[:aes.BlockSize]).CryptBlocks(padded, padded)
	return base64.StdEncoding.EncodeToString(padded), nil
}
