测试用自签名证书（仅用于单元测试，不要用于任何真实服务）。生成命令：

    openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 -subj "/CN=book.example.com" -addext "subjectAltName=DNS:book.example.com"
    openssl req -x509 -newkey rsa:2048 -nodes -keyout other-key.pem -out other-cert.pem -days 3650 -subj "/CN=other.example.com" -addext "subjectAltName=DNS:other.example.com"
    cat cert.pem other-cert.pem > chain.pem
