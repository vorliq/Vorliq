from __future__ import annotations

from .block import Block


class ProofOfWorkConsensus:
    def __init__(self, difficulty: int = 3) -> None:
        self.difficulty = difficulty

    @property
    def target_prefix(self) -> str:
        return "0" * self.difficulty

    def mine(self, block: Block) -> Block:
        while not block.hash().startswith(self.target_prefix):
            block.nonce += 1
        return block

    def is_valid_block(self, block: Block) -> bool:
        return block.hash().startswith(self.target_prefix)
