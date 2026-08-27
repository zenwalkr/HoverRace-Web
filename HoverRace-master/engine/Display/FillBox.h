
// FillBox.h
//
// Copyright (c) 2013-2016 Michael Imamura.
//
// Licensed under GrokkSoft HoverRace SourceCode License v1.0(the "License");
// you may not use this file except in compliance with the License.
//
// A copy of the license should have been attached to the package from which
// you have taken this file. If you can not find the license you can not use
// this file.
//
//
// The author makes no representations about the suitability of
// this software for any purpose.  It is provided "as is" "AS IS",
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
// implied.
//
// See the License for the specific language governing permissions
// and limitations under the License.

#pragma once

#include "Color.h"

#include "Box.h"

#if defined(_WIN32) && defined(HR_ENGINE_SHARED)
#	ifdef MR_ENGINE
#		define MR_DllDeclare   __declspec( dllexport )
#	else
#		define MR_DllDeclare   __declspec( dllimport )
#	endif
#else
#	define MR_DllDeclare
#endif

namespace HoverRace {
	namespace Display {
		class Display;
	}
}

namespace HoverRace {
namespace Display {

/**
 * A colored rectangle, that's all.
 * @author Michael Imamura
 */
class MR_DllDeclare FillBox : public Box
{
	using SUPER = Box;

public:
	struct Props
	{
		enum {
			COLOR = SUPER::Props::NEXT_,
			BORDER,
			BORDER_COLOR,
			NEXT_,  ///< First index for subclasses.
		};
	};

public:
	FillBox(const Vec2 &size, const Color color,
		uiLayoutFlags_t layoutFlags = 0);
	FillBox(double w, double h, const Color color,
		uiLayoutFlags_t layoutFlags = 0);
	FillBox(const Vec2 &size, const Color color, double border,
		const Color borderColor, uiLayoutFlags_t layoutFlags = 0);
	FillBox(double w, double h, const Color color, double border,
		const Color borderColor, uiLayoutFlags_t layoutFlags = 0);
	virtual ~FillBox() { }

public:
	virtual void AttachView(Display &disp) { AttachViewDynamic(disp, this); }

public:
	const Color GetColor() const { return color; }
	void SetColor(const Color color);

	double GetBorder() const { return border; }
	void SetBorder(double border);

	const Color GetBorderColor() const { return borderColor; }
	void SetBorderColor(const Color color);

private:
	Color color;
	double border;
	Color borderColor;
};

}  // namespace Display
}  // namespace HoverRace

#undef MR_DllDeclare
