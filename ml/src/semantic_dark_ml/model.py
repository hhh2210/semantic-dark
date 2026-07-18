from __future__ import annotations

import torch
from torch import nn

from .ontology import KNOWN_LABELS


class DepthwiseSeparableBlock(nn.Module):
    def __init__(self, input_channels: int, output_channels: int, *, stride: int = 1) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(
                input_channels,
                input_channels,
                kernel_size=3,
                stride=stride,
                padding=1,
                groups=input_channels,
                bias=False,
            ),
            nn.Conv2d(input_channels, output_channels, kernel_size=1, bias=False),
            nn.GroupNorm(_group_count(output_channels), output_channels),
            nn.SiLU(inplace=True),
        )

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.layers(inputs)


class TinyRgbaClassifier(nn.Module):
    """Four-channel depthwise-separable CNN for four known visual classes."""

    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(4, 16, kernel_size=3, stride=2, padding=1, bias=False),
            nn.GroupNorm(4, 16),
            nn.SiLU(inplace=True),
            DepthwiseSeparableBlock(16, 32, stride=2),
            DepthwiseSeparableBlock(32, 48, stride=2),
            DepthwiseSeparableBlock(48, 64, stride=2),
            DepthwiseSeparableBlock(64, 96, stride=2),
            nn.AdaptiveAvgPool2d(1),
        )
        self.classifier = nn.Linear(96, len(KNOWN_LABELS))
        if trainable_parameter_count(self) >= 150_000:
            raise AssertionError("TinyRgbaClassifier exceeded the 150k parameter budget")

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.features(inputs).flatten(1))


def trainable_parameter_count(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)


def _group_count(channels: int) -> int:
    for groups in (8, 4, 2):
        if channels % groups == 0:
            return groups
    return 1
