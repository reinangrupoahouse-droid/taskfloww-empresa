# Taskfloww Empresa

Cópia local do Taskfloww com tema preto como padrão, criada em 25/11/2026.

Origem: `/Users/rei/Documents/Projetos Consultoria /taskflow`, commit `094c70c`.

O código e as migrações foram copiados. Credenciais, dados, configuração local da Vercel e vínculo Git do original não foram copiados.

Repositório: `reinangrupoahouse-droid/taskfloww-empresa`. Supabase exclusivo: `cdbiewrwgmhzhzzqlzqx`, organização `taskfloww-Empresa`. O build utiliza apenas a chave publicável; as chaves administrativas não fazem parte do frontend nem do repositório.

GitHub Pages é publicado a partir da branch `gh-pages`, com `npm run deploy:pages` em `https://reinangrupoahouse-droid.github.io/taskfloww-empresa/`. Recursos que dependem do servidor TanStack (como processamento de IA) exigem hospedagem com backend e não são executados no Pages. Integrações com Google, Instagram e notificações push precisam de configuração própria no novo ambiente.

Use `npm install` e `npm run dev` para desenvolvimento na porta 5187. Configure um `.env.local` próprio conforme `.env.example` para habilitar os serviços. Não coloque chaves administrativas em variáveis `VITE_*`.

O tema começa em preto inclusive no login. O controle de tema permite alternar para o modo claro, com a preferência salva em `taskfloww-empresa-theme`.
