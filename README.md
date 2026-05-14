![Vorliq Logo](docs/logo.png)

Vorliq
======

[![Vorliq CI](https://github.com/vorliq/Vorliq/actions/workflows/ci.yml/badge.svg)](https://github.com/vorliq/Vorliq/actions/workflows/ci.yml)
![Version 1.0](https://img.shields.io/badge/version-1.0-6c63ff.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Coin: VLQ](https://img.shields.io/badge/coin-VLQ-6c63ff.svg)

Live website: https://vorliq.github.io/Vorliq

What is Vorliq
--------------

Vorliq is a complete community savings and lending platform built on its own lightweight blockchain. It does not depend on Ethereum, Bitcoin, Solana, or any outside cryptocurrency network. The native coin is called VLQ, and the application includes a Python proof of work blockchain core, a Node.js backend API, a React web application, and a React Native mobile application.

Vorliq is designed for real communities that want to save, send, lend, trade, and govern value together. Members can create wallets, mine blocks, send signed VLQ transactions, request community loans, vote on loans with VLQ balance as voting weight, post buy and sell offers on the decentralized exchange, connect peer nodes, monitor network health, and vote on governance proposals that can change network rules.

What is VLQ
-----------

VLQ is the native coin of the Vorliq network. The maximum supply is 21 million VLQ. The starting mining reward is 50 VLQ per block, and the scheduled reward halves every 210000 blocks. Mining rewards are created by the Vorliq blockchain itself and normal transactions are signed with SECP256K1 cryptographic keys.

Vorliq also includes community governance, so VLQ holders can vote on proposals that change network parameters. That means the community can vote to change the mining reward, block difficulty, loan rules, exchange limits, and other supported settings instead of relying on a central operator.

Features
--------

Vorliq includes a complete proof of work blockchain written in Python. Blocks contain signed transactions, link to the previous block by hash, and are mined with a proof of work target. Wallets use real SECP256K1 keys and addresses derived from public key hashing.

The community savings and lending system lets members request VLQ loans and lets other members vote to approve or reject them using VLQ balance as voting weight. Approved loans are issued through the blockchain and repayments are tracked by the lending system.

The decentralized VLQ exchange lets community members post buy and sell offers directly inside Vorliq. Offers can describe any community-agreed price, such as money, goods, services, or time, so local communities can trade in the way that makes sense to them.

The peer to peer network lets Vorliq nodes register peers, broadcast transactions and blocks, discover other peers, and synchronize to the longest valid chain. The network has been tested with multi node stress tests covering synchronization, network partition recovery, and double spend prevention.

The community governance system gives VLQ holders on-chain voting power over Vorliq rules. Members can propose changes, vote with balance-weighted votes, and approved proposals automatically apply supported changes such as mining reward and difficulty updates.

The React web application provides the browser interface for wallets, sending VLQ, mining, chain exploration, lending, exchange, governance, node registry, statistics, account history, notifications, and health monitoring. The React Native mobile application brings wallet, sending, lending, exchange, governance, settings, and notifications to Android and iOS through Expo.

Vorliq includes encrypted browser wallet storage, local key storage on mobile, dark and light mode, persistent notifications, push notification support through Expo, node diagnostics, rotating logs, a public node registry, GitHub Pages documentation, a full test suite, GitHub Actions CI, and production deployment documentation.

How to Run
----------

To run Vorliq on Windows, install Git, Node.js LTS, and Python 3.12 first. When installing Python, make sure the Add to PATH checkbox is selected. After those tools are installed, open a terminal in the folder where you want Vorliq to live and run `git clone https://github.com/vorliq/Vorliq.git`. Then open the downloaded Vorliq folder.

The easiest way to start the application is to double click `start.bat` in the root folder. The script starts the Python blockchain API, the Node.js backend API, the React web app, and the heartbeat service in separate terminal windows. After the windows open, visit `http://localhost:3000` in your browser.

If you are setting up from a fresh clone, install the dependencies first. In the `blockchain` folder create and activate the Python virtual environment with `python -m venv .venv` and `.venv\Scripts\activate`, then run `pip install -r requirements.txt`. In the `backend` folder run `npm install`. In the `frontend` folder run `npm install`. In the `mobile` folder run `npm install` if you want to run the Expo mobile application.

To use the mobile app, install Expo Go on your phone, open a terminal in the `mobile` folder, run `npx expo start`, and scan the QR code with Expo Go. In the mobile Settings screen, set the node URL to the IP address and port of your running Vorliq backend, usually something like `http://192.168.1.20:5000` on your local network.

Community
---------

Discord: https://discord.gg/qpX5sHD4pC

Telegram: https://t.me/Vorliq

Reddit: https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS

GitHub: https://github.com/vorliq/Vorliq

X: https://x.com/vorliq
