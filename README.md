## Integrador NF-e/CT-e 🚀

Este é um aplicativo Node.js projetado para buscar, baixar e transferir de maneira fácil, documentos fiscais eletrônicos (NF-e, CT-e, etc.) em formato XML. O aplicativo atua como uma ponte entre a **API da Siege** para busca de documentos e a **API da NF STOCK** para o envio, tudo dentro de uma arquitetura **MVC** simples.

O principal objetivo é automatizar o processo de coleta de notas fiscais de uma empresa específica (identificada pelo **CNPJ**) e enviá-las automaticamente para a plataforma de destino, economizando tempo e garantindo a consistência dos dados.

---

## 💻 Funcionalidades

* **Busca Inteligente**: O sistema utiliza a API da Siege para buscar documentos fiscais em um intervalo de datas selecionado, com um período máximo de 3 meses.
* **Download Automático**: Após a busca, todos os documentos XML encontrados são baixados automaticamente.
* **Upload Direcionado**: Os documentos são enviados automaticamente para a plataforma NF STOCK através de sua API, lidando com todo o processo, incluindo a autenticação (OAuth 2.0).
* **Filtragem de Documentos**: O aplicativo garante que apenas notas que ainda não foram processadas sejam enviadas, evitando uploads duplicados.
* **Controle de Concorrência**: Os documentos são enviados de forma concorrente para otimizar o desempenho sem sobrecarregar a API.
* **Operação Constante**: Usando o `node-cron`, o servidor pode ser configurado para realizar buscas e transferências de forma automática e periódica.

---

## 🛠️ Tecnologias & Dependências

* **Node.js**: O ambiente de servidor.
* **Express**: Um framework de aplicação web minimalista e flexível para Node.js.
* **Axios**: Um cliente HTTP baseado em promises para fazer requisições à API.
* **Node-Cron**: Uma biblioteca para agendar tarefas (por exemplo, buscas automáticas).
* **Dotenv**: Um módulo que carrega variáveis de ambiente de um arquivo `.env`.
* **Body-Parser**: Middleware para analisar corpos de requisição recebidos.

---

## 📁 Estrutura do Projeto

Este projeto segue uma arquitetura MVC (Model-View-Controller), embora seja mais focado nos componentes **Model** (lógica de processamento de dados) e **Controller** (orquestração de serviços), já que não há uma 'View' tradicional (páginas HTML). A estrutura é organizada da seguinte forma:

* `src/`: O diretório principal do código-fonte da aplicação.
    * `controllers/`: Contém a lógica de negócios que orquestra as ações dos modelos e serviços.
    * `models/`: Gerencia dados e a lógica de negócios. Neste caso, rastreia quais notas já foram processadas para evitar duplicação.
    * `routes/`: Define as rotas da API.
    * `services/`: Contém a lógica para interagir com APIs externas (Siege e NF STOCK).
    * `config.js`: Gerencia as configurações globais da aplicação e as variáveis de ambiente.
    * `index.js`: O ponto de entrada da aplicação.

---

## ⚙️ Como Executar

1.  **Clone o repositório**:
    ```bash
    git clone [url_do_repositório]
    cd integrador
    ```
2.  **Instale as dependências**:
    ```bash
    npm install
    ```
3.  **Configure as variáveis de ambiente**: Crie um arquivo `.env` na raiz do projeto com suas chaves de API e outras configurações.
    ```bash
    SIEG_API_KEY=sua_chave_da_api_siege
    SIEG_API_BASE=[https://api.sieg.com](https://api.sieg.com)
    NFSTOCK_API_TOKEN=seu_token_da_api_nfstock

    ```
4.  **Execute a aplicação**:
    * Para produção:
        ```bash
        npm start
        ```
    * Para desenvolvimento (com reinício automático ao salvar):
        ```bash
        npm run dev
        ```
5.  **Use o serviço**: Acesse a aplicação via interface web ou chamada de API (se implementado) para fornecer o CNPJ e o intervalo de datas, e então clique em "Processar". O aplicativo cuidará do resto.
