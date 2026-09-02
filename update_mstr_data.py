import re
import json
import urllib.request

try:
    # 1. 코인게코 무료 API에서 퍼블릭 기업 비트코인 보유량 데이터 가져오기
    url = "https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    data = json.loads(response.read())
    
    # 2. MSTR 데이터 찾기 (기본값 845050)
    mstr_btc = 845050 
    for company in data.get('companies', []):
        if company.get('symbol') == 'mstr':
            mstr_btc = int(company.get('total_holdings', 845050))
            break
            
    print(f"현재 MSTR BTC 보유량: {mstr_btc}")
    
    # 3. 내 저장소의 script.js 파일 읽기
    with open('script.js', 'r', encoding='utf-8') as f:
        script_content = f.read()
        
    # 4. 정규식을 이용해 script.js 안의 btcHoldings 값만 자동으로 덮어쓰기
    new_content = re.sub(
        r'btcHoldings:\s*\d+',
        f'btcHoldings: {mstr_btc}',
        script_content
    )
    
    # 5. 수정된 내용 저장하기
    with open('script.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
        
    print("script.js 파일 자동 업데이트 완료!")
    
except Exception as e:
    print(f"데이터 업데이트 중 오류 발생: {e}")

