import re
import json
import urllib.request

try:
    # 1. 코인게코 API (접속 차단 방지용 헤더 추가)
    url = "https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
    })
    response = urllib.request.urlopen(req)
    data = json.loads(response.read())
    
    # 2. MSTR 데이터 찾기 (소수점 에러 방지용 float 거쳐 int 변환)
    mstr_btc = 845050 
    for company in data.get('companies', []):
        if company.get('symbol') == 'mstr':
            mstr_btc = int(float(company.get('total_holdings', 845050)))
            break
            
    print(f"현재 MSTR BTC 보유량: {mstr_btc}")
    
    # 3. script.js 읽기
    with open('script.js', 'r', encoding='utf-8') as f:
        script_content = f.read()
        
    # 4. 정규식 덮어쓰기 (소수점이 포함된 숫자가 있더라도 완벽히 덮어쓰도록 강화)
    new_content = re.sub(
        r'btcHoldings:\s*\d+(?:\.\d+)?',
        f'btcHoldings: {mstr_btc}',
        script_content
    )
    
    # 5. 파일 저장
    with open('script.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
        
    print("script.js 파일 자동 업데이트 완료!")
    
except Exception as e:
    print(f"데이터 업데이트 중 오류 발생: {e}")
