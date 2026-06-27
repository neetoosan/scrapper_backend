import re
import sys

def test_extract_state(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        source = f.read()
        
    marker = "APP_INITIALIZATION_STATE="
    start = source.find(marker)
    if start < 0:
        print("Marker not found")
        return
        
    end = source.find(";", start)
    snippet = source[start:end if end > start else start + 200000]
    
    # decodeEscapedString logic
    def decode_escaped(match):
        val = match.group(1)
        val = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), val)
        val = val.replace('\\n', ' ')
        val = val.replace('\\"', '"')
        val = val.replace('\\\\', '\\')
        return val.strip()
        
    strings = [decode_escaped(m) for m in re.finditer(r'"((?:\\.|[^"\\])*)"', snippet)]
    
    def is_plausible_name(val):
        if not val: return False
        t = val.strip()
        if len(t) < 3 or len(t) > 90: return False
        if re.search(r'\b(log in|sign up|privacy policy|terms of service|investor relations|recent activity|write a review)\b', t, re.I): return False
        if len(t) < 2 or re.search(r'\b(results|google maps|menu|open now|closed|overview)\b', t, re.I): return False
        if re.search(r'^restaurants? in ', t, re.I): return False
        if re.search(r'^[\d\s.,-]+$', t): return False
        return bool(re.search(r'[A-Za-z]{2,}', t))
        
    for index in range(len(strings)):
        value = strings[index]
        if not is_plausible_name(value): continue
        
        window = " | ".join(strings[index:index+8])
        phone_match = re.search(r'\+\d[\d\s-]{7,14}\d', window)
        category = None
        for item in strings[index+1:index+6]:
            if re.search(r'\b(restaurant|hotel|school|hospital|bakery|cafe|bar|salon|mall|store|repair|agency|services|clinic|station|gym|pharmacy|market)\b', item, re.I):
                category = item
                break
                
        # print plausible name with its context to debug
        print(f"[{index}] NAME: {value}")
        print(f"  Phone: {phone_match.group(0) if phone_match else None}")
        print(f"  Category: {category}")
        print(f"  Context: {window[:150]}")
        
test_extract_state('maps_test.html')
