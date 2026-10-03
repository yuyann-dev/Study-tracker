import json

traj = r'C:\Users\MXyuan\AppData\Local\Doubao\User Data\Profile 3\.doubao\agent_mode\workspace\.sessions\38445237088195586\agents\o_000csrYbqmF\system\trajectory.jsonl'

with open(traj, 'r', encoding='utf-8') as f:
    for i, line in enumerate(f):
        obj = json.loads(line)
        role = obj.get('role', 'unknown')
        print(f'=== LINE {i} role={role} ===')
        content = obj.get('content', '')
        if content:
            print(content[:3000])
        tc = obj.get('tool_calls', [])
        if tc:
            for t in tc:
                print(f'  tool_call: {t["function"]["name"]}')
                args = t['function'].get('arguments', '')
                if args:
                    if isinstance(args, dict):
                        print(f'    args: {json.dumps(args, ensure_ascii=False)[:500]}')
                    else:
                        print(f'    args: {str(args)[:500]}')
        print()
