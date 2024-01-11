import { Button, ButtonProps, createTheme, styled } from "@mui/material";

const ColorButtonStyle = styled(Button)<ButtonProps>(({ theme }) => ({
  minWidth: "120px",
  fontSize: "12px",
  fontWeight: "800",
  lineHeight: "16px",
  padding:"6px 8px",
  borderRadius: "3px",
  '&:hover': {
    color: theme.palette.secondary.main,
    backgroundColor: theme.palette.primary.main,
    // textDecoration:"underline"
  },
  '&:disabled': {
    color: theme.palette.secondary.main,
    backgroundColor: theme.palette.primary.main,
    opacity:0.5
    // textDecoration:"underline"
  }
})) as typeof Button;


const ColorButtonStyleAlt = styled(Button)<ButtonProps>(() => ({
  minWidth: "120px",
  fontSize: "12px",
  fontWeight: "600",
  lineHeight: "16px",
  padding:"6px 8px",
  borderRadius: "3px",
  color: "#4b4b4b",
  backgroundColor: "rgba(0,0,0,0.05)",
  '&:hover': {
    color: "#4b4b4b",
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  '&:disabled': {
    color: "black",
    backgroundColor: "rgba(0,0,0,0.05)",
    opacity:0.5
  }
})) as typeof Button;

export const ColorButton = (props:ButtonProps) => (<ColorButtonStyle variant="contained" disableElevation {...props} />)

export const ColorButtonAlt = (props:ButtonProps) => (<ColorButtonStyleAlt variant="contained" disableElevation {...props} />)

export const theme = createTheme({
  palette: {
    primary: { main: "#d73449" },
    secondary: { main: "#ffffff" },
  },
  typography: {
    fontFamily: [ 
      "Noto Sans" 
    ].join(",")
  },
  /* // no need but good to know!
  components: {
    MuiIconButton: {
      styleOverrides:{
        root: {
          "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.04)" }
        }
      }
    }
  }
  */
});
